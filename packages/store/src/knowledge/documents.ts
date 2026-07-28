/**
 * 文档仓储。
 *
 * 没有 update 语义 —— 文件变了就整体替换它的全部块。
 * 增量的判断在上层（比对 contentHash），这一层只负责「换掉」这个动作的原子性。
 */

import { newId } from '@mycelia/shared'
import type { Db } from '../db.js'
import { type ChunkInput, type DocumentRow, type StoredDocument, toDocument } from './types.js'

export interface ReplaceResult {
  document: StoredDocument
  /** 新写入的块 ID，顺序与传入的 chunks 一致，调用方据此写向量 */
  chunkIds: string[]
  /** 被替换掉的旧块 ID，调用方据此清理内存向量索引 */
  removedChunkIds: string[]
}

export class DocumentRepo {
  constructor(private readonly db: Db) {}

  get(id: string): StoredDocument | undefined {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      | DocumentRow
      | undefined
    return row ? toDocument(row) : undefined
  }

  bySource(sourceId: string): StoredDocument[] {
    const rows = this.db
      .prepare('SELECT * FROM documents WHERE source_id = ? ORDER BY rel_path ASC')
      .all(sourceId) as DocumentRow[]
    return rows.map(toDocument)
  }

  byRelPath(sourceId: string, relPath: string): StoredDocument | undefined {
    const row = this.db
      .prepare('SELECT * FROM documents WHERE source_id = ? AND rel_path = ?')
      .get(sourceId, relPath) as DocumentRow | undefined
    return row ? toDocument(row) : undefined
  }

  getMany(ids: readonly string[]): StoredDocument[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM documents WHERE id IN (${placeholders})`)
      .all(...ids) as DocumentRow[]
    return rows.map(toDocument)
  }

  /**
   * 写入文档及其全部块，整体替换旧版本。
   *
   * 单事务完成：索引中途崩溃不会留下「文档记录已更新但块还是旧的」这种不一致。
   */
  replace(
    doc: Omit<StoredDocument, 'id' | 'chunkCount' | 'indexedAt'> & { id?: string },
    chunks: readonly ChunkInput[],
  ): ReplaceResult {
    const now = Date.now()
    const existing = this.byRelPath(doc.sourceId, doc.relPath)
    const docId = existing?.id ?? doc.id ?? newId('doc')

    const removedChunkIds = existing
      ? (
          this.db.prepare('SELECT id FROM chunks WHERE document_id = ?').all(docId) as Array<{
            id: string
          }>
        ).map((row) => row.id)
      : []

    const chunkIds: string[] = []

    const deleteChunks = this.db.prepare('DELETE FROM chunks WHERE document_id = ?')
    const deleteFts = this.db.prepare('DELETE FROM chunk_fts WHERE chunk_id = ?')
    const insertChunk = this.db.prepare(`
      INSERT INTO chunks
        (id, document_id, source_id, ord, heading, content, char_start, char_end, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertFts = this.db.prepare(
      'INSERT INTO chunk_fts (chunk_id, heading, content) VALUES (?, ?, ?)',
    )
    const upsertDoc = this.db.prepare(`
      INSERT INTO documents
        (id, source_id, rel_path, abs_path, title, ext, size_bytes, mtime,
         content_hash, chunk_count, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, rel_path) DO UPDATE SET
        abs_path = excluded.abs_path, title = excluded.title, ext = excluded.ext,
        size_bytes = excluded.size_bytes, mtime = excluded.mtime,
        content_hash = excluded.content_hash, chunk_count = excluded.chunk_count,
        indexed_at = excluded.indexed_at
    `)

    this.db.transaction(() => {
      for (const chunkId of removedChunkIds) deleteFts.run(chunkId)
      deleteChunks.run(docId)

      upsertDoc.run(
        docId,
        doc.sourceId,
        doc.relPath,
        doc.absPath,
        doc.title,
        doc.ext,
        doc.sizeBytes,
        doc.mtime,
        doc.contentHash,
        chunks.length,
        now,
      )

      for (const chunk of chunks) {
        const chunkId = newId('chk')
        chunkIds.push(chunkId)
        insertChunk.run(
          chunkId,
          docId,
          doc.sourceId,
          chunk.ord,
          chunk.heading,
          chunk.content,
          chunk.charStart,
          chunk.charEnd,
          now,
        )
        insertFts.run(chunkId, chunk.heading, chunk.content)
      }
    })()

    return { document: this.get(docId)!, chunkIds, removedChunkIds }
  }

  /** 文件在磁盘上没了。返回被删的块 ID，供调用方同步内存向量索引 */
  remove(id: string): string[] {
    const chunkIds = (
      this.db.prepare('SELECT id FROM chunks WHERE document_id = ?').all(id) as Array<{
        id: string
      }>
    ).map((row) => row.id)

    const deleteFts = this.db.prepare('DELETE FROM chunk_fts WHERE chunk_id = ?')
    this.db.transaction(() => {
      for (const chunkId of chunkIds) deleteFts.run(chunkId)
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    })()

    return chunkIds
  }
}
