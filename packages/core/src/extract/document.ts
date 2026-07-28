import type { LlmProvider } from '@mycelia/llm'
import { extractJson } from '@mycelia/llm'
import type { ExtractionConfig } from '@mycelia/shared'
import { createLogger, truncate } from '@mycelia/shared'
import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js'
import type { RawMemory } from './types.js'

const log = createLogger('core:extract:document')

/**
 * 从文档里提炼记忆。
 *
 * 与对话提取共用同一套判断标准和 kind 分类（那份 prompt 已经把「什么值得
 * 长期记住」讲透了），但输入形态完全不同，得单独说清楚：
 *
 *   - 对话是过程，要从来回讨论里挑出**最终结论**，中间的试错都是噪音；
 *   - 文档是成品，作者已经整理过一遍了。这里的任务是**挑出其中能独立成立
 *     的断言**，而不是把整篇摘要一遍 —— 摘要没有检索价值，原文本来就在库里。
 *
 * 所以对文档要更克制：一篇讲清楚一件事的笔记，通常只该产出一到三条记忆。
 */

const DOCUMENT_TASK = `## 这次的输入是一篇文档，不是对话

文档已经是整理过的成品，你的任务不是再摘要一遍 —— 原文完整地存在库里，
随时可以检索到。你要挑出的是**能脱离这篇文档独立成立、且以后会被反复用到的断言**。

判断方法：设想三个月后，用户在别的项目里问起相关问题。哪几句话是他真正需要
被提醒的？那才是记忆。文档的结构、章节标题、行文脉络都不是。

特别注意：
- 一篇讲清楚一件事的笔记，通常只产出 1~3 条。整篇都"很重要"意味着你没有在挑。
- 不要把标题改写一下当成记忆。
- 不要产出"这篇文档介绍了 X"这类元描述 —— 那是文档的属性，不是知识。
- 文档里的凭据照实记录，sensitivity 标 secret。`

export interface DocumentExtractionInput {
  title: string
  text: string
  /** 已有标签，引导模型复用 */
  existingTags?: string[]
}

export interface DocumentExtractionResult {
  memories: RawMemory[]
  method: 'llm' | 'skipped'
  durationMs: number
  error?: string
}

/**
 * 送进模型的正文上限。
 *
 * 一篇笔记通常几 KB，但挂载目录里难免混进几万字的长文。整篇塞进去既慢又贵，
 * 而值得记的断言几乎总在前半部分（文档一般是先给结论再展开细节）。
 */
const MAX_CHARS = 8000

export async function extractFromDocument(
  llm: LlmProvider,
  config: ExtractionConfig,
  input: DocumentExtractionInput,
): Promise<DocumentExtractionResult> {
  const started = Date.now()

  /**
   * 没配模型就直接跳过，不降级到规则提取。
   *
   * 规则提取是为对话设计的（找「记住」「以后都」这类指令性措辞），
   * 拿它扫文档只会捞出一堆噪音 —— 而噪音进了待确认队列，就要用户
   * 一条条去清，那比没有还糟。
   */
  if (!llm.enabled) {
    return { memories: [], method: 'skipped', durationMs: 0 }
  }

  const system = `${EXTRACTION_SYSTEM_PROMPT}\n\n${DOCUMENT_TASK}`.replace(
    '{{MAX}}',
    String(config.maxMemoriesPerConversation),
  )

  const tags = input.existingTags?.length
    ? `\n\n已有标签（优先复用）：${input.existingTags.slice(0, 40).join('、')}`
    : ''

  const user = `文档标题：${input.title}\n\n---\n\n${truncate(input.text, MAX_CHARS)}${tags}`

  try {
    const result = await llm.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { json: true, temperature: 0.1 },
    )

    const parsed = extractJson<{ memories?: RawMemory[] }>(result.text)
    if (!parsed) {
      log.warn('模型输出不是合法 JSON', { title: input.title, head: result.text.slice(0, 200) })
      return {
        memories: [],
        method: 'skipped',
        durationMs: Date.now() - started,
        error: 'LLM 输出不是合法 JSON',
      }
    }

    const memories = Array.isArray(parsed.memories) ? parsed.memories : []
    log.info('已从文档提炼记忆', { title: input.title, count: memories.length })
    return { memories, method: 'llm', durationMs: Date.now() - started }
  } catch (cause) {
    // 之前这里静默返回，界面只显示「N 篇失败」而查不到为什么
    log.warn('提炼失败', { title: input.title, error: String(cause) })
    return {
      memories: [],
      method: 'skipped',
      durationMs: Date.now() - started,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}
