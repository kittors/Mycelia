import type { EntityKind, MemoryKind, Sensitivity } from '@mycelia/shared'
import { clamp, normalizeTag, truncate } from '@mycelia/shared'

const VALID_KINDS = new Set<MemoryKind>([
  'fact',
  'preference',
  'decision',
  'howto',
  'credential',
  'project',
  'learning',
  'issue',
  'insight',
  'entity',
])

const VALID_ENTITY_KINDS = new Set<EntityKind>([
  'person',
  'repo',
  'service',
  'host',
  'tech',
  'file',
  'org',
  'concept',
])

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

/** LLM 返回的原始形状 —— 一切字段都当作不可信 */
export interface RawMemory {
  kind?: string
  title?: string
  content?: string
  tags?: unknown
  sensitivity?: string
  confidence?: unknown
  importance?: unknown
  entities?: unknown
}

/**
 * 把模型吐出来的东西清洗成能落库的形状。
 *
 * 抽出来给对话提取和文档提取共用：两条路径喂给模型的 prompt 不同，但
 * 「什么样的返回值可以信」是同一套判断。各写一份的话，迟早出现一边
 * 收紧了校验、另一边还在放行脏数据。
 */
export function normalizeRawMemory(
  raw: RawMemory,
): Omit<ExtractedMemory, 'sourceMessageIds'> | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const content = typeof raw.content === 'string' ? raw.content.trim() : ''
  if (!title || !content) return null
  // 标题比正文还长说明模型没理解要求，这种条目质量通常也差
  if (title.length > 120) return null

  const kind = (VALID_KINDS.has(raw.kind as MemoryKind) ? raw.kind : 'fact') as MemoryKind

  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.filter((t): t is string => typeof t === 'string').map(normalizeTag))]
        .filter(Boolean)
        .slice(0, 6)
    : []

  const sensitivity = (
    ['public', 'private', 'secret'].includes(raw.sensitivity as string)
      ? raw.sensitivity
      : 'private'
  ) as Sensitivity

  const entities = Array.isArray(raw.entities)
    ? raw.entities
        .map((e) => {
          const obj = e as { name?: unknown; kind?: unknown }
          const name = typeof obj.name === 'string' ? obj.name.trim() : ''
          if (!name || name.length > 80) return null
          const ekind = (
            VALID_ENTITY_KINDS.has(obj.kind as EntityKind) ? obj.kind : 'concept'
          ) as EntityKind
          return { name, kind: ekind }
        })
        .filter((e): e is { name: string; kind: EntityKind } => e !== null)
        .slice(0, 8)
    : []

  return {
    kind,
    title: truncate(title, 120),
    content,
    tags,
    sensitivity,
    confidence: clamp(toNumber(raw.confidence, 0.7)),
    importance: clamp(toNumber(raw.importance, 0.5)),
    entities,
  }
}

/** 模型有时把数字写成字符串，甚至写成 "high" —— 认不出来就退回默认值 */
function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}
