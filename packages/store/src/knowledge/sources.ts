/**
 * 知识源仓储：被挂载的文档目录。
 *
 * 这一层的核心约束是**文件是唯一事实来源**。表里的一切都是索引产物，
 * 随时可以整个删掉重建，绝不反向写回磁盘。
 */

import { newId } from '@mycelia/shared'
import type { Db } from '../db.js'
import { type SourceRow, type SourceStatus, type StoredSource, toSource } from './types.js'

export class SourceRepo {
  constructor(private readonly db: Db) {}

  all(): StoredSource[] {
    const rows = this.db
      .prepare('SELECT * FROM knowledge_sources ORDER BY created_at ASC')
      .all() as SourceRow[]
    return rows.map(toSource)
  }

  get(id: string): StoredSource | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id) as
      | SourceRow
      | undefined
    return row ? toSource(row) : undefined
  }

  byPath(path: string): StoredSource | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_sources WHERE path = ?').get(path) as
      | SourceRow
      | undefined
    return row ? toSource(row) : undefined
  }

  /** 同一个目录只挂一次，重复挂载返回已有记录而不是报错 */
  add(input: {
    name: string
    path: string
    extensions?: string[]
    exclude?: string[]
    watch?: boolean
  }): StoredSource {
    const existing = this.byPath(input.path)
    if (existing) return existing

    const now = Date.now()
    const id = newId('src')
    this.db
      .prepare(`
        INSERT INTO knowledge_sources
          (id, name, path, enabled, watch, extensions, exclude, status, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, 'idle', ?, ?)
      `)
      .run(
        id,
        input.name,
        input.path,
        input.watch === false ? 0 : 1,
        JSON.stringify(input.extensions ?? ['md', 'mdx', 'txt']),
        JSON.stringify(input.exclude ?? ['node_modules', '.git', '.obsidian']),
        now,
        now,
      )
    return this.get(id)!
  }

  update(
    id: string,
    patch: Partial<Pick<StoredSource, 'name' | 'enabled' | 'watch' | 'extensions' | 'exclude'>>,
  ): StoredSource | undefined {
    const sets: string[] = []
    const values: unknown[] = []

    if (patch.name !== undefined) {
      sets.push('name = ?')
      values.push(patch.name)
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(patch.enabled ? 1 : 0)
    }
    if (patch.watch !== undefined) {
      sets.push('watch = ?')
      values.push(patch.watch ? 1 : 0)
    }
    if (patch.extensions !== undefined) {
      sets.push('extensions = ?')
      values.push(JSON.stringify(patch.extensions))
    }
    if (patch.exclude !== undefined) {
      sets.push('exclude = ?')
      values.push(JSON.stringify(patch.exclude))
    }
    if (sets.length === 0) return this.get(id)

    sets.push('updated_at = ?')
    values.push(Date.now(), id)
    this.db.prepare(`UPDATE knowledge_sources SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  setStatus(id: string, status: SourceStatus, error?: string): void {
    this.db
      .prepare('UPDATE knowledge_sources SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, error ?? null, Date.now(), id)
  }

  /** 索引完成后刷新统计。计数从实表现算，避免增量维护出现漂移 */
  refreshCounts(id: string): void {
    const now = Date.now()
    this.db
      .prepare(`
        UPDATE knowledge_sources SET
          doc_count       = (SELECT COUNT(*) FROM documents WHERE source_id = ?),
          chunk_count     = (SELECT COUNT(*) FROM chunks WHERE source_id = ?),
          last_indexed_at = ?,
          updated_at      = ?
        WHERE id = ?
      `)
      .run(id, id, now, now, id)
  }

  remove(id: string): boolean {
    // documents / chunks 靠外键级联；chunk_fts 是虚表没有外键，必须手动清
    const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE source_id = ?').all(id) as Array<{
      id: string
    }>
    const deleteFts = this.db.prepare('DELETE FROM chunk_fts WHERE chunk_id = ?')

    this.db.transaction(() => {
      for (const { id: chunkId } of chunkIds) deleteFts.run(chunkId)
    })()

    return this.db.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(id).changes > 0
  }
}
