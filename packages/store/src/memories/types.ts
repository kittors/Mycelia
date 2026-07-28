/** 记忆仓储的查询与统计类型 */

export interface ListFilter {
  kinds?: string[]
  tags?: string[]
  tagMode?: 'any' | 'all'
  project?: string
  agent?: string
  sensitivity?: string[]
  status?: string[]
  since?: number
  until?: number
  pinnedOnly?: boolean
  limit?: number
  offset?: number
  orderBy?: 'updated' | 'created' | 'importance' | 'accessed'
}

export interface MemoryStats {
  total: number
  byKind: Record<string, number>
  byStatus: Record<string, number>
  bySensitivity: Record<string, number>
  byAgent: Record<string, number>
  byProject: Record<string, number>
  pending: number
  embedded: number
  oldestAt: number | null
  newestAt: number | null
}
