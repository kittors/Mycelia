import type {
  CaptureMode,
  Memory,
  MemoryKind,
  MemoryOrigin,
  MemoryStatus,
  Sensitivity,
} from '@mycelia/shared'

/** 数据库行的原始形状 —— 只在 store 内部流通 */
export interface MemoryRow {
  id: string
  kind: string
  title: string
  content: string
  summary: string
  tags: string
  sensitivity: string
  status: string
  confidence: number
  importance: number
  pinned: number
  origin: string
  created_at: number
  updated_at: number
  last_accessed_at: number | null
  access_count: number
  expires_at: number | null
  content_hash: string
  embedding_model: string | null
  capture_mode: string
  recall_count: number
  last_recalled_at: number | null
}

/** 读出来的记忆。locked=true 表示 content 仍是密文占位符 */
export interface StoredMemory extends Memory {
  locked?: boolean
}

export function rowToMemory(row: MemoryRow): StoredMemory {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    title: row.title,
    content: row.content,
    summary: row.summary,
    tags: safeParse<string[]>(row.tags, []),
    sensitivity: row.sensitivity as Sensitivity,
    status: row.status as MemoryStatus,
    confidence: row.confidence,
    importance: row.importance,
    pinned: row.pinned === 1,
    origin: safeParse<MemoryOrigin>(row.origin, { agent: 'unknown', messageIds: [] }),
    // 迁移前写入的行没有这一列，读出来是 undefined，兜底成 manual
    captureMode: (row.capture_mode ?? 'manual') as CaptureMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    accessCount: row.access_count,
    recallCount: row.recall_count ?? 0,
    lastRecalledAt: row.last_recalled_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    contentHash: row.content_hash,
    embeddingModel: row.embedding_model ?? undefined,
  }
}

export function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}
