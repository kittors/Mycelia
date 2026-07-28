export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  maxTokens?: number
  temperature?: number
  /** 要求模型只输出 JSON。各家实现方式不同，由 provider 各自处理 */
  json?: boolean
  timeoutMs?: number
  signal?: AbortSignal
  /** 单次调用覆盖模型，用于把高频轻量任务下放给小模型 */
  model?: string
}

export interface ChatResult {
  text: string
  inputTokens?: number
  outputTokens?: number
  model: string
}

export interface LlmProvider {
  readonly id: string
  readonly model: string
  /** false 表示没配模型，调用方应该走规则降级而不是报错 */
  readonly enabled: boolean
  chat(messages: readonly ChatMessage[], opts?: ChatOptions): Promise<ChatResult>
  /** 连通性自检，供 `myc doctor` 与设置页的「测试连接」按钮使用 */
  test(): Promise<{ ok: boolean; message: string; latencyMs?: number }>
}

/**
 * 从模型输出里抠出 JSON。
 *
 * 现实是：再怎么强调「只输出 JSON」，模型还是会裹上 ```json 围栏，
 * 或者在前面加一句「好的，这是提取结果：」。与其祈祷，不如容错。
 */
export function extractJson<T = unknown>(text: string): T | null {
  const trimmed = text.trim()

  // 1. 直接就是合法 JSON
  try {
    return JSON.parse(trimmed) as T
  } catch {
    /* 继续尝试 */
  }

  // 2. Markdown 代码围栏
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as T
    } catch {
      /* 继续尝试 */
    }
  }

  // 3. 抓第一个平衡的 { } 或 [ ]（处理前后有解说文字的情况）
  const balanced = extractBalanced(trimmed)
  if (balanced) {
    try {
      return JSON.parse(balanced) as T
    } catch {
      /* 放弃 */
    }
  }

  return null
}

function extractBalanced(s: string): string | null {
  const startIdx = s.search(/[[{]/)
  if (startIdx === -1) return null
  const open = s[startIdx]!
  const close = open === '{' ? '}' : ']'

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIdx; i < s.length; i++) {
    const c = s[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return s.slice(startIdx, i + 1)
    }
  }
  return null
}
