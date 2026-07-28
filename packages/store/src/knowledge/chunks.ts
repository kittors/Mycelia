/**
 * 文档块仓储。
 *
 * 块是检索的最小单位。这里除了常规读取，还提供 withNeighbors ——
 * 它是对抗碎片化的最后一环：检索用小块保证精准，
 * 呈现时把命中块与邻居拼回去，用户看到的是完整的一段而不是半句话。
 */

import type { Db } from '../db.js'
import { type ChunkRow, type StoredChunk, toChunk } from './types.js'

export class ChunkRepo {
  constructor(private readonly db: Db) {}

  get(id: string): StoredChunk | undefined {
    const row = this.db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as ChunkRow | undefined
    return row ? toChunk(row) : undefined
  }

  /** 保持调用方给定的顺序 —— 传进来的通常已按检索得分排好 */
  getMany(ids: readonly string[]): StoredChunk[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids) as ChunkRow[]

    const byId = new Map(rows.map((row) => [row.id, toChunk(row)]))
    return ids
      .map((id) => byId.get(id))
      .filter((chunk): chunk is StoredChunk => chunk !== undefined)
  }

  byDocument(documentId: string): StoredChunk[] {
    const rows = this.db
      .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY ord ASC')
      .all(documentId) as ChunkRow[]
    return rows.map(toChunk)
  }

  /** 取某块及其前后邻居，拼成连续上下文 */
  withNeighbors(chunkId: string, radius = 1): StoredChunk[] {
    const chunk = this.get(chunkId)
    if (!chunk) return []

    const rows = this.db
      .prepare(
        'SELECT * FROM chunks WHERE document_id = ? AND ord BETWEEN ? AND ? ORDER BY ord ASC',
      )
      .all(chunk.documentId, chunk.ord - radius, chunk.ord + radius) as ChunkRow[]
    return rows.map(toChunk)
  }

  /**
   * 全文检索。trigram 分词器对中文友好，无需外部分词库。
   *
   * 查询串畸形时返回空而不是抛错 —— FTS 的 MATCH 语法对特殊字符很敏感，
   * 用户随手输个引号不该让整个检索挂掉。
   */
  search(
    query: string,
    limit: number,
    sourceIds?: readonly string[],
  ): Array<{ id: string; score: number }> {
    const sanitized = query.replace(/["']/g, ' ').trim()
    if (sanitized.length < 2) return []

    const scopeClause =
      sourceIds && sourceIds.length > 0
        ? `AND c.source_id IN (${sourceIds.map(() => '?').join(',')})`
        : ''

    try {
      const rows = this.db
        .prepare(`
          SELECT f.chunk_id AS id, bm25(chunk_fts) AS rank
          FROM chunk_fts f
          JOIN chunks c ON c.id = f.chunk_id
          WHERE chunk_fts MATCH ? ${scopeClause}
          ORDER BY rank
          LIMIT ?
        `)
        .all(`"${sanitized}"`, ...(sourceIds ?? []), limit) as Array<{ id: string; rank: number }>

      // bm25 返回负数，越小越相关。归一到 0~1 才能与向量分数同量纲加权融合
      return rows.map((row) => ({ id: row.id, score: 1 / (1 + Math.abs(row.rank)) }))
    } catch {
      return []
    }
  }

  count(sourceId?: string): number {
    const row = sourceId
      ? this.db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE source_id = ?').get(sourceId)
      : this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get()
    return (row as { n: number }).n
  }
}
