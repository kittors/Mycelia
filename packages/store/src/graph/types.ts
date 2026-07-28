/**
 * 图谱层的行类型与映射。
 *
 * 边和实体的数据库行结构在这里收口，三个仓储只写 SQL，不各自重复一遍转换。
 */

import type { Edge, EdgeKind, Entity, EntityKind } from '@mycelia/shared'
import { safeParse } from '../rows.js'

export interface EdgeRow {
  id: string
  source_id: string
  target_id: string
  kind: string
  weight: number
  reason: string | null
  created_at: number
}

export interface EntityRow {
  id: string
  kind: string
  key: string
  name: string
  aliases: string
  description: string
  mention_count: number
  created_at: number
  updated_at: number
}

export function toEdge(row: EdgeRow): Edge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    kind: row.kind as EdgeKind,
    weight: row.weight,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
  }
}

export function toEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    kind: row.kind as EntityKind,
    key: row.key,
    name: row.name,
    aliases: safeParse<string[]>(row.aliases, []),
    description: row.description,
    mentionCount: row.mention_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
