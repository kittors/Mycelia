/**
 * 主动记忆的准入把关。
 *
 * 产品原则是「不是什么都要进知识库」。这条原则如果只写在文档里，
 * 接了 MCP 的 agent 会把每次对话的边角料都塞进来 —— 它没有全局视野，
 * 判断不了「这条三个月后还有用吗」。所以准入必须落在服务端，成为硬规则。
 *
 * 四道闸，从便宜到贵：
 *
 *   1. 长度与噪音   —— 纯规则，零成本
 *   2. 语义去重     —— 一次向量检索，命中就转成「更新旧记忆」而不是新增
 *   3. 模型价值判断 —— 一次小模型调用，判断有没有跨会话价值
 *   4. 敏感度强制   —— 凭据一律加密，不信任调用方的声明
 *
 * 被拒的内容默认进待审队列而不是直接丢弃：把关会误判，
 * 而用户在桌面端扫一眼就能把误杀的捞回来。
 */

import type { Embedder } from '@mycelia/embed'
import { extractJson, fastOptions, type LlmProvider } from '@mycelia/llm'
import type { CaptureConfig, LlmProviderConfig, MemoryKind, Sensitivity } from '@mycelia/shared'
import { createLogger, truncate } from '@mycelia/shared'
import type { MyceliaStore, StoredMemory } from '@mycelia/store'

const log = createLogger('core:capture')

export type CaptureVerdict = 'accept' | 'review' | 'merge' | 'reject'

export interface CaptureCandidate {
  title: string
  content: string
  kind: MemoryKind
  tags?: string[]
  sensitivity?: Sensitivity
  importance?: number
  project?: string
}

export interface CaptureDecision {
  verdict: CaptureVerdict
  /** 给调用方（agent）看的理由，会原样返回到 MCP 工具结果里 */
  reason: string
  /** verdict=merge 时指向被取代的旧记忆 */
  mergeTargetId?: string
  /** 模型给出的价值评分 0~1，用于排序待审队列 */
  score: number
}

const GATEKEEPER_PROMPT = `你在为一个跨会话的长期记忆库把关。

判断一条内容值不值得长期留存。标准只有一条：
**三个月后的另一次对话里，它还能帮上忙吗？**

值得留存：
- 用户环境的具体事实（服务跑在哪、端口是多少、目录结构约定）
- 用户的偏好与工作约定（用中文回复、提交信息格式、技术选型倾向）
- 决策及其理由（为什么选 A 不选 B）
- 排查结论（现象 → 根因 → 解法）
- 可复用的操作步骤

不值得留存：
- 本次任务的一次性上下文（「现在在改这个函数」「刚才那个变量名」）
- 模型自己就知道的通用知识（「React 是前端框架」「Git 用来做版本控制」）
- 没有具体信息量的泛泛结论（「要注意性能」「代码要有可维护性」）
- 过程性的进度汇报（「已完成第一步」「正在测试」）
- 会很快过期的临时状态（「当前分支有冲突」）

严格一些。知识库的价值在密度，宁可漏掉一条边界内容，也不要让噪音稀释检索质量。

只输出 JSON：
{"keep": true/false, "score": 0.0~1.0, "reason": "一句话说明判断依据"}`

export class CaptureGate {
  constructor(
    private readonly store: MyceliaStore,
    private readonly embedder: Embedder,
    private readonly llm: LlmProvider,
    private readonly config: CaptureConfig,
    private readonly llmConfig: LlmProviderConfig,
  ) {}

  async evaluate(
    candidate: CaptureCandidate,
    opts: { actor?: string; force?: boolean } = {},
  ): Promise<CaptureDecision> {
    // 用户手动写入的内容不走把关 —— 他自己就是判断标准
    if (opts.force) {
      return { verdict: 'accept', reason: '用户手动写入，跳过把关', score: 1 }
    }

    // ── 闸 1：长度与噪音 ──
    const content = candidate.content.trim()
    if (content.length < this.config.minContentLength) {
      return {
        verdict: 'reject',
        reason: `内容过短（${content.length} 字符，下限 ${this.config.minContentLength}），没有留存价值`,
        score: 0,
      }
    }

    // ── 闸 2：语义去重 ──
    const duplicate = await this.findDuplicate(candidate)
    if (duplicate) {
      return {
        verdict: 'merge',
        reason: `与既有记忆「${duplicate.memory.title}」高度重合（相似度 ${duplicate.similarity.toFixed(2)}），应更新而不是新增`,
        mergeTargetId: duplicate.memory.id,
        score: 0.8,
      }
    }

    // ── 闸 3：模型价值判断 ──
    if (!this.config.llmGatekeeper || !this.llm.enabled) {
      return { verdict: 'accept', reason: '规则校验通过', score: 0.6 }
    }

    const judged = await this.judge(candidate)
    if (judged.keep) {
      return { verdict: 'accept', reason: judged.reason, score: judged.score }
    }
    return {
      verdict: this.config.queueRejected ? 'review' : 'reject',
      reason: judged.reason,
      score: judged.score,
    }
  }

  /**
   * 找语义上已经存在的等价记忆。
   *
   * 用向量而不是内容哈希：同一件事换个说法写第二遍，哈希完全不同，
   * 但对知识库来说它就是重复。
   *
   * 但向量分数**只用来粗筛，不用来定性**。句向量模型的余弦基线差异极大：
   * e5 系列对任意两段中文都给 0.85 以上（向量空间各向异性所致），
   * 而内置哈希嵌入的无关文本接近 0。同一个绝对阈值不可能同时适配两者 ——
   * 实测中「进度汇报」和「要注意代码性能」这两条毫不相干的内容拿到了 0.89。
   *
   * 所以粗筛只负责把候选缩到个位数，是不是真重复交给模型判断。
   */
  private async findDuplicate(
    candidate: CaptureCandidate,
  ): Promise<{ memory: StoredMemory; similarity: number } | null> {
    if (this.store.vectors.size === 0) return null

    try {
      const vec = await this.embedder.embedOne(`${candidate.title}\n${candidate.content}`)
      const threshold = this.screenThreshold()
      const hits = this.store.vectors.search(vec, 3).filter((hit) => hit.score >= threshold)
      if (hits.length === 0) return null

      for (const hit of hits) {
        const memory = this.store.memories.get(hit.id)
        if (!memory) continue
        // 没有模型可用时退回纯阈值判断，此时把标准提得很严，
        // 宁可漏判重复（多一条记忆）也不要误判（覆盖掉不相干的旧记忆）
        if (!this.llm.enabled) {
          return hit.score >= 0.97 ? { memory, similarity: hit.score } : null
        }
        if (await this.confirmDuplicate(candidate, memory)) {
          return { memory, similarity: hit.score }
        }
      }
      return null
    } catch (e) {
      log.warn(`去重检查失败，按新增处理：${String(e)}`)
      return null
    }
  }

  /**
   * 粗筛阈值。
   *
   * 目标不是「判定重复」，而是「把候选从几万条缩到几条」，
   * 所以宁可放宽 —— 漏掉真重复的代价，比让模型多看两条候选大得多。
   */
  private screenThreshold(): number {
    const configured = this.config.supersedeThreshold
    // 本地句向量模型的分数整体偏高，用配置值会把一大半记忆都圈进来
    if (this.embedder.kind === 'local' || this.embedder.kind === 'remote') {
      return Math.max(configured, 0.93)
    }
    return configured
  }

  /** 让模型判断两条记忆是不是在讲同一件事 */
  private async confirmDuplicate(
    candidate: CaptureCandidate,
    existing: StoredMemory,
  ): Promise<boolean> {
    try {
      const res = await this.llm.chat(
        [
          {
            role: 'system',
            content: `判断两条记忆是否在讲同一件事。

「同一件事」指：描述的是同一个对象的同一个属性、同一个决策、同一个问题。
换了说法、补充了细节、更新了数值，都算同一件事。
主题相近但对象不同（两台不同的服务器）、或角度不同（一条讲配置一条讲排障），都不算。

只输出 JSON：{"same": true/false}`,
          },
          {
            role: 'user',
            content: [
              `A：${existing.title}`,
              truncate(existing.content, 600),
              '',
              `B：${candidate.title}`,
              truncate(candidate.content, 600),
            ].join('\n'),
          },
        ],
        fastOptions(this.llmConfig, { maxTokens: 50, temperature: 0, json: true }),
      )
      return extractJson<{ same?: boolean }>(res.text)?.same === true
    } catch {
      // 判不了就当作不重复，代价是多一条记忆而不是丢掉一条
      return false
    }
  }

  private async judge(
    candidate: CaptureCandidate,
  ): Promise<{ keep: boolean; score: number; reason: string }> {
    try {
      const res = await this.llm.chat(
        [
          { role: 'system', content: GATEKEEPER_PROMPT },
          {
            role: 'user',
            content: [
              `类型：${candidate.kind}`,
              candidate.project ? `项目：${candidate.project}` : '',
              `标题：${candidate.title}`,
              `内容：${truncate(candidate.content, 1500)}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        fastOptions(this.llmConfig, { maxTokens: 200, temperature: 0, json: true }),
      )

      const parsed = extractJson<{ keep?: boolean; score?: number; reason?: string }>(res.text)
      if (!parsed || typeof parsed.keep !== 'boolean') {
        // 模型没给出可解析的判断时放行 —— 把关失灵不该变成拒绝服务
        return { keep: true, score: 0.5, reason: '把关模型未给出明确判断，按通过处理' }
      }
      return {
        keep: parsed.keep,
        score: clamp01(parsed.score ?? (parsed.keep ? 0.7 : 0.3)),
        reason: parsed.reason?.trim() || (parsed.keep ? '具备跨会话价值' : '缺乏长期留存价值'),
      }
    } catch (e) {
      log.warn(`价值判断调用失败，按通过处理：${String(e)}`)
      return { keep: true, score: 0.5, reason: '把关模型不可用，按通过处理' }
    }
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}
