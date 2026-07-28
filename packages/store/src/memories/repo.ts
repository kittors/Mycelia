/**
 * 记忆仓储。
 *
 * 门面角色：写入、读取、状态流转的编排在这里，
 * 具体的 SQL 构造（query）、检索（search）、统计（stats）、加解密（secrets）
 * 各自成模块。这个类只负责把它们串起来并保证事务边界。
 */

import type { Vault } from '@mycelia/crypto'
import type { Memory, MemoryInput, MemoryPatch } from '@mycelia/shared'
import { tagAncestors } from '@mycelia/shared'
import type { Db } from '../db.js'
import type { MemoryRow, StoredMemory } from '../rows.js'
import type { VectorIndex } from '../vectors.js'
import { buildListQuery } from './query.js'
import { fullTextSearch } from './search.js'
import { encryptContent, hydrateRow } from './secrets.js'
import { collectStats } from './stats.js'
import type { ListFilter, MemoryStats } from './types.js'
import { insertMemory, updateMemory, type WriteContext } from './writes.js'

export class MemoryRepo {
  constructor(
    private readonly db: Db,
    private readonly vectors: VectorIndex,
    private readonly vault: Vault | null,
  ) {}

  insert(input: MemoryInput, actor = 'system'): StoredMemory {
    return insertMemory(this.writeContext(), input, actor)
  }

  /**
   * 按标题找一条记忆。
   *
   * 给「别重复提取」用：同一篇文档改个错别字就会重新索引，而模型对同一段
   * 内容给出的标题相当稳定，撞上就说明这条已经提过了。
   */
  findByTitle(title: string): StoredMemory | undefined {
    const row = this.db.prepare('SELECT id FROM memories WHERE title = ? LIMIT 1').get(title) as
      | { id: string }
      | undefined
    return row ? this.get(row.id) : undefined
  }

  update(id: string, patch: MemoryPatch, actor = 'user'): StoredMemory {
    return updateMemory(this.writeContext(), id, patch, actor)
  }

  /** 把私有工具打包给写入模块 —— 它们涉及事务内的多表同步，不适合再拆一层 */
  private writeContext(): WriteContext {
    return {
      db: this.db,
      vault: this.vault,
      vectors: this.vectors,
      hydrate: (row, decrypt) => this.hydrate(row, decrypt),
      maybeEncrypt: (content, sensitivity) => this.maybeEncrypt(content, sensitivity),
      getRaw: (id) => this.getRaw(id),
      syncFts: (id, memory, sensitivity) => this.syncFts(id, memory, sensitivity),
      bumpTags: (tags, now) => this.bumpTags(tags, now),
      audit: (actor, action, memoryId, detail) => this.audit(actor, action, memoryId, detail),
    }
  }
  get(id: string, opts: { decrypt?: boolean } = {}): StoredMemory | undefined {
    const row = this.getRaw(id)
    if (!row) return undefined
    return this.hydrate(row, opts.decrypt ?? true)
  }

  getMany(ids: readonly string[], opts: { decrypt?: boolean } = {}): StoredMemory[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .all(...ids) as MemoryRow[]
    // 保持调用方给的顺序（检索结果的排序不能被 SQL 打乱）
    const byId = new Map(rows.map((r) => [r.id, r]))
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is MemoryRow => Boolean(r))
      .map((r) => this.hydrate(r, opts.decrypt ?? true))
  }

  findByHash(hash: string): StoredMemory | undefined {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE content_hash = ? LIMIT 1')
      .get(hash) as MemoryRow | undefined
    return row ? this.hydrate(row, true) : undefined
  }

  list(filter: ListFilter = {}): StoredMemory[] {
    const { sql, params } = buildListQuery(filter)
    const rows = this.db.prepare(sql).all(...params) as MemoryRow[]
    return rows.map((r) => this.hydrate(r, true))
  }

  count(filter: ListFilter = {}): number {
    const { sql, params } = buildListQuery({ ...filter, limit: undefined, offset: undefined }, true)
    const row = this.db.prepare(sql).get(...params) as { n: number }
    return row.n
  }

  delete(id: string, actor = 'user'): boolean {
    const existing = this.getRaw(id)
    if (!existing) return false
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id)
      this.db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?').run(id, id)
      this.vectors.remove(this.db, id)
      this.audit(actor, 'delete', id, existing.title)
    })()
    return true
  }

  /** 记录一次访问 —— 访问频次会反哺检索排序与图谱节点大小 */
  recordAccess(ids: readonly string[]): void {
    if (ids.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare(
      'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?',
    )
    this.db.transaction(() => {
      for (const id of ids) stmt.run(now, id)
    })()
  }

  /**
   * 记录检索命中。
   *
   * 与 recordAccess 分开统计：被打开看过一次，和被检索反复召回，
   * 说明的是两件事。后者才是「这条记忆真的在发挥作用」的信号，
   * 也是将来做记忆衰减与清理时的保留依据。
   */
  recordRecall(ids: readonly string[]): void {
    if (ids.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare(
      'UPDATE memories SET recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?',
    )
    this.db.transaction(() => {
      for (const id of ids) stmt.run(now, id)
    })()
  }

  /** 没有向量的记忆 —— 嵌入任务的输入 */
  needsEmbedding(model: string, limit = 200): StoredMemory[] {
    const rows = this.db
      .prepare(`
        SELECT m.* FROM memories m
        LEFT JOIN memory_vectors v ON v.memory_id = m.id
        WHERE m.status IN ('active', 'pending')
          AND (v.memory_id IS NULL OR v.model != ?)
        ORDER BY m.updated_at DESC
        LIMIT ?
      `)
      .all(model, limit) as MemoryRow[]
    return rows.map((r) => this.hydrate(r, true))
  }

  stats(): MemoryStats {
    return collectStats(this.db)
  }

  /** 全文检索。返回 (id, bm25 分数)，分数已转成越大越好 */
  fullTextSearch(query: string, limit: number) {
    return fullTextSearch(this.db, query, limit)
  }

  private hydrate(row: MemoryRow, decrypt: boolean): StoredMemory {
    return hydrateRow(this.vault, row, decrypt)
  }

  private maybeEncrypt(content: string, sensitivity: string): string {
    return encryptContent(this.vault, content, sensitivity)
  }

  private getRaw(id: string): MemoryRow | undefined {
    return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined
  }

  /**
   * 同步全文索引。
   * secret 记忆只索引标题与标签 —— 正文进了 FTS 表就等于明文落盘，
   * 加密也就白做了。代价是加密记忆只能按标题搜到，这个取舍是值得的。
   */
  private syncFts(id: string, memory: Memory, sensitivity: string) {
    this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(id)
    const body = sensitivity === 'secret' ? '' : `${memory.content}\n${memory.summary}`
    this.db
      .prepare('INSERT INTO memory_fts (memory_id, title, content, tags) VALUES (?, ?, ?, ?)')
      .run(id, memory.title, body, memory.tags.join(' '))
  }

  private bumpTags(tags: readonly string[], now: number) {
    const stmt = this.db.prepare(`
      INSERT INTO tags (tag, count, created_at) VALUES (?, 1, ?)
      ON CONFLICT(tag) DO UPDATE SET count = count + 1
    `)
    // 祖先标签也计数：搜 infra 时能带出 infra/ssh 下的全部记忆
    const all = new Set<string>()
    for (const t of tags) for (const a of tagAncestors(t)) all.add(a)
    for (const t of all) stmt.run(t, now)
  }

  private audit(actor: string, action: string, memoryId: string, detail: string) {
    this.db
      .prepare(
        'INSERT INTO audit_log (at, actor, action, memory_id, detail) VALUES (?, ?, ?, ?, ?)',
      )
      .run(Date.now(), actor, action, memoryId, detail)
  }
}
