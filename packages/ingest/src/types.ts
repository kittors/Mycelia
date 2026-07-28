import type { AgentSource, Conversation, IngestCursor } from '@mycelia/shared'

/** 一个待读取的会话源（一个文件，或数据库里的一个 session） */
export interface SourceRef {
  /** 唯一标识：文件路径，或 `opencode:<sessionId>` */
  ref: string
  agent: AgentSource
  /** 文件修改时间 / 会话最后更新时间，用于跳过没变化的源 */
  modifiedAt: number
  sizeBytes?: number
}

export interface ReadResult {
  conversation: Conversation | null
  /** 更新后的游标；null 表示无变化 */
  cursor: Omit<IngestCursor, 'updatedAt'> | null
}

export interface DiscoverOptions {
  /** 只看这个时间点之后修改过的源 */
  since?: number
  /** 排除路径前缀 */
  excludePaths?: readonly string[]
  /** 最多返回多少个源 */
  limit?: number
}

/**
 * 会话源适配器。
 * 每个 agent 的落盘格式天差地别，这个接口是它们唯一的共同契约。
 * 新增一个 agent 支持 = 新增一个实现，其余代码零改动。
 */
export interface SessionSource {
  readonly agent: AgentSource
  /** 这个源在本机是否可用（目录/数据库存在） */
  isAvailable(): boolean
  /** 数据根路径，用于展示与文件监听 */
  readonly rootPath: string
  discover(opts?: DiscoverOptions): Promise<SourceRef[]>
  /** 从游标位置增量读取。cursor 为空表示首次全量读 */
  read(ref: SourceRef, cursor?: IngestCursor): Promise<ReadResult>
}

/**
 * 识别「不是人说的话」。
 *
 * 各家 agent 都会把系统指令、AGENTS.md、环境上下文伪装成 user 消息塞进对话流。
 * 这些内容一旦被当成用户输入去提取记忆，就会产出「用户要求遵守 AGENTS.md」
 * 这类毫无价值的记忆，还会把真正的偏好淹没掉。宁可漏，不可错。
 */
const INJECTED_PATTERNS = [
  /^<system-reminder>/,
  /^<environment_context>/,
  /^<user_instructions>/,
  /^<INSTRUCTIONS>/i,
  /^#\s*AGENTS\.md instructions/i,
  /^#\s*CLAUDE\.md/i,
  /^Caveat:/,
  /^<command-name>/,
  /^<local-command-stdout>/,
  /^\[Request interrupted/,
  /^<budget_status>/,
]

export function isInjectedContent(text: string): boolean {
  const head = text.trimStart()
  return INJECTED_PATTERNS.some((re) => re.test(head))
}

/** 把 tool_use / tool_result 之类的结构化内容压平成可读文本 */
export function flattenContent(content: unknown): { text: string; toolName?: string } {
  if (typeof content === 'string') return { text: content }
  if (!Array.isArray(content)) return { text: '' }

  const parts: string[] = []
  let toolName: string | undefined

  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    switch (b.type) {
      case 'text':
      case 'input_text':
      case 'output_text':
        if (typeof b.text === 'string') parts.push(b.text)
        break
      case 'thinking':
      case 'reasoning':
        // 思考过程不进记忆库：它是模型的草稿纸，噪音远大于信号
        break
      case 'tool_use':
      case 'function_call':
        toolName = String(b.name ?? b.tool_name ?? 'tool')
        // 只留工具名与关键参数，完整参数往往是几百行代码
        parts.push(`[调用工具 ${toolName}]${summarizeToolInput(b.input ?? b.arguments)}`)
        break
      case 'tool_result':
      case 'function_call_output': {
        const out = b.content ?? b.output
        const text = typeof out === 'string' ? out : flattenContent(out).text
        if (text) parts.push(`[工具结果] ${text.slice(0, 500)}`)
        break
      }
      case 'image':
        parts.push('[图片]')
        break
      default:
        if (typeof b.text === 'string') parts.push(b.text)
    }
  }

  return { text: parts.join('\n').trim(), toolName }
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  // 优先展示这些字段：它们最能说明「做了什么」
  const interesting = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']
  for (const key of interesting) {
    const v = obj[key]
    if (typeof v === 'string' && v.length > 0) return ` ${v.slice(0, 200)}`
  }
  return ''
}
