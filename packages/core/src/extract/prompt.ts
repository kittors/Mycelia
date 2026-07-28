import type { Conversation } from '@mycelia/shared'
import { truncate } from '@mycelia/shared'

/**
 * 提取 prompt。
 *
 * 这段文字的质量直接决定整个产品的价值 —— 记忆库里装的是精华还是垃圾，全看它。
 * 设计原则：
 *   1. 宁缺毋滥。一次对话产出 0 条记忆是完全正常的结果，必须明说，
 *      否则模型会为了「完成任务」硬编出一堆废话。
 *   2. 记忆要脱离上下文独立成立。「那个 bug 修好了」在三个月后毫无意义。
 *   3. 区分「事件」与「知识」。只有能复用的才值得长期保存。
 *   4. 安全信息必须标出来，宁可误报。
 */
export const EXTRACTION_SYSTEM_PROMPT = `你是 Mycelia 的记忆提炼引擎。你的职责是从人与 AI 编程助手的对话中，提炼出**值得长期保存**的知识。

## 核心判断标准

一条信息值得成为长期记忆，当且仅当它满足：**三个月后再看，依然有用**。

值得记的：
- 用户的稳定偏好与工作习惯（"提交信息必须用中文"、"禁止在服务器上重启网络服务"）
- 环境与基础设施事实（服务器角色、端口分配、部署路径、数据库位置）
- 技术决策及其**理由**（"选 SQLite 而非 Postgres，因为要支持离线单机"）
- 可复现的操作步骤（部署命令、排障流程、构建脚本用法）
- 排障结论（现象 → 根因 → 解法）
- 项目进展与阶段性成果（这周完成了什么、当前卡在哪）
- 学到的新知识、踩过的坑
- 访问凭据与连接方式（必须标记为敏感）

不值得记的：
- 对话过程本身（"用户让我读文件，我读了"）
- 一次性的临时状态（"当前分支是 feature/x"）
- 公开可查的通用知识（"React useState 怎么用"）
- AI 的思考过程、道歉、寒暄
- 没有结论的中间尝试（试了 A 不行，试了 B 也不行，最后没解决）
- 代码本身（记结论和位置，不要把整段代码抄进来）

## 记忆类型

| kind | 用途 |
|---|---|
| fact | 稳定的客观事实（服务、端口、路径、版本约束） |
| preference | 用户的偏好与要求 |
| decision | 技术选型/架构决策 + 理由 |
| howto | 可复现的操作步骤 |
| credential | 密钥、密码、SSH、连接串（**必定敏感**） |
| project | 项目进展、里程碑、当前阻塞 |
| learning | 新学到的知识、踩坑记录 |
| issue | 问题 → 根因 → 解法 |
| insight | 跨越具体任务的经验总结 |
| entity | 某个服务器/仓库/服务的档案式描述 |

## 敏感度

- \`secret\`：包含密钥、密码、token、私钥、连接串。**只要沾边就选它。**
- \`private\`：内部信息，不含凭据（内网 IP、业务逻辑、未公开的项目名）
- \`public\`：通用技术知识

## 标签

用层级标签，小写，斜杠分隔。例如：
\`infra/ssh\`、\`infra/docker\`、\`dev/frontend\`、\`dev/electron\`、\`project/清风\`、\`learning/rust\`、\`ops/deploy\`

每条记忆 1~4 个标签。优先复用已有标签（会在输入里给出）。

## 输出格式

只输出 JSON，不要任何解释文字：

\`\`\`json
{
  "memories": [
    {
      "kind": "fact",
      "title": "一句话概括，20 字以内，能独立看懂",
      "content": "完整内容。补齐上下文，让人脱离原对话也能理解。可以用 Markdown。",
      "tags": ["infra/ssh"],
      "sensitivity": "public",
      "confidence": 0.9,
      "importance": 0.6,
      "entities": [{ "name": "server-hk-01", "kind": "host" }]
    }
  ]
}
\`\`\`

字段说明：
- confidence：你对「这确实是条有价值的记忆」的把握，0~1
- importance：这条记忆的长期价值，0~1。用户明确要求记住的给 0.9+
- entities：涉及的实体。kind 取值：person / repo / service / host / tech / file / org / concept

## 硬性要求

1. **没有值得记的内容就返回 \`{"memories": []}\`**。这是正常且常见的结果，不要凑数。
2. 一次最多 {{MAX}} 条。质量远比数量重要。
3. content 必须自包含：不能出现"上面提到的"、"那个文件"、"如前所述"。
4. 用中文写 title 和 content（专有名词、命令、代码保持原文）。
5. 凭据类内容照实记录，但 sensitivity 必须是 secret —— 系统会自动加密存储。`

export interface PromptContext {
  conversation: Conversation
  /** 已有标签，引导模型复用而不是每次发明新的 */
  existingTags?: string[]
  maxMemories: number
  /** 相关的已有记忆，避免重复提取 */
  relatedMemories?: Array<{ title: string; kind: string }>
}

export function buildExtractionPrompt(ctx: PromptContext): { system: string; user: string } {
  const { conversation: conv } = ctx
  const system = EXTRACTION_SYSTEM_PROMPT.replace('{{MAX}}', String(ctx.maxMemories))

  const parts: string[] = []

  parts.push('## 会话元信息')
  parts.push(`- 来源 agent：${conv.agent}`)
  if (conv.project) parts.push(`- 项目：${conv.project}`)
  if (conv.cwd) parts.push(`- 工作目录：${conv.cwd}`)
  if (conv.branch) parts.push(`- 分支：${conv.branch}`)
  parts.push(`- 时间：${new Date(conv.startedAt).toLocaleString('zh-CN')}`)

  if (ctx.existingTags?.length) {
    parts.push('')
    parts.push('## 已有标签（优先复用）')
    parts.push(ctx.existingTags.slice(0, 40).join('、'))
  }

  if (ctx.relatedMemories?.length) {
    parts.push('')
    parts.push('## 已存在的相关记忆（不要重复提取）')
    for (const m of ctx.relatedMemories.slice(0, 10)) {
      parts.push(`- [${m.kind}] ${m.title}`)
    }
  }

  parts.push('')
  parts.push('## 对话内容')
  parts.push(renderTranscript(conv))

  return { system, user: parts.join('\n') }
}

/**
 * 渲染对话文本。
 *
 * 长会话必须裁剪 —— 我见过 9MB 的单个 pi 会话文件。
 * 裁剪策略：保留全部用户消息（用户说的话信息密度最高），
 * 助手消息按长度截断。用户的话才是记忆的主要来源。
 */
export function renderTranscript(conv: Conversation, maxChars = 24_000): string {
  const lines: string[] = []
  let budget = maxChars

  // 从后往前收集：最近的对话通常包含结论
  const collected: string[] = []
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]!
    const label = m.role === 'user' ? '用户' : 'AI'
    // 用户消息给足配额，助手消息压缩到 800 字
    const limit = m.role === 'user' ? 4000 : 800
    const text = truncate(m.text.trim(), limit)
    if (!text) continue

    const line = `[${label}] ${text}`
    if (budget - line.length < 0) {
      // 预算用尽，但如果还没收到任何用户消息，强行留一条
      if (collected.length === 0) collected.push(line.slice(0, budget))
      break
    }
    budget -= line.length
    collected.push(line)
  }

  collected.reverse()
  lines.push(...collected)

  if (collected.length < conv.messages.length) {
    lines.unshift(
      `（对话较长，此处只保留最后 ${collected.length} / ${conv.messages.length} 条消息）\n`,
    )
  }

  return lines.join('\n\n')
}

/** 会话摘要 prompt —— 用于生成「这周干了啥」的项目周报 */
export const DIGEST_SYSTEM_PROMPT = `你是 Mycelia 的活动摘要引擎。

给你一批某个时间段内的会话标题与记忆，请生成一份简洁的工作纪要。

要求：
- 按项目分组
- 每个项目 2~5 条要点，说清楚**做完了什么**、**遇到什么问题**、**当前卡在哪**
- 不要复述对话过程，只写结果与结论
- 用中文，Markdown 无序列表
- 客观陈述，不要评价、不要鼓励语

只输出 Markdown 正文，不要标题、不要前言。`
