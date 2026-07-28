import type { EntityKind, MemoryKind, Sensitivity } from '@mycelia/shared'

/** 提取器的输出 —— 还没落库的候选记忆 */
export interface ExtractedMemory {
  kind: MemoryKind
  title: string
  content: string
  tags: string[]
  sensitivity: Sensitivity
  confidence: number
  importance: number
  entities: Array<{ name: string; kind: EntityKind }>
  /** 贡献了这条记忆的消息 ID，用于溯源 */
  sourceMessageIds: string[]
}

export interface ExtractionOutcome {
  memories: ExtractedMemory[]
  /** 走的是 LLM 还是规则降级 —— UI 上要让用户看见 */
  method: 'llm' | 'rules'
  model?: string
  inputTokens?: number
  outputTokens?: number
  durationMs: number
  error?: string
}
