/**
 * 实体仓储。
 *
 * 实体是图谱能看出「神经簇」的关键：记忆之间往往没有直接引用，
 * 但都指向同一台服务器、同一个仓库。把实体也做成节点，簇结构才会自然浮现。
 */

import type { Entity, EntityKind } from '@mycelia/shared'
import { newId, normalizeKey } from '@mycelia/shared'
import type { Db } from '../db.js'
import { safeParse } from '../rows.js'
import { type EntityRow, toEntity } from './types.js'

export class EntityRepo {
  constructor(private readonly db: Db) {}

  /**
   * 按规范化 key 落地实体。
   * 同一台服务器可能被叫成「香港服务器」「server-hk-01」「43.x.x.x」，
   * 别名合并在这里发生 —— 合并得越准，图谱的簇就越干净。
   */
  upsert(kind: EntityKind, name: string, aliases: string[] = [], description = ''): Entity {
    const key = normalizeKey(name)
    const now = Date.now()
    const existing = this.db.prepare('SELECT * FROM entities WHERE key = ?').get(key) as
      | EntityRow
      | undefined

    if (existing) {
      const mergedAliases = [...new Set([...safeParse<string[]>(existing.aliases, []), ...aliases])]
      this.db
        .prepare(`
          UPDATE entities SET
            aliases = ?, mention_count = mention_count + 1, updated_at = ?,
            description = CASE WHEN description = '' THEN ? ELSE description END
          WHERE id = ?
        `)
        .run(JSON.stringify(mergedAliases), now, description, existing.id)
      return toEntity({
        ...existing,
        aliases: JSON.stringify(mergedAliases),
        mention_count: existing.mention_count + 1,
      })
    }

    const id = newId('ent')
    this.db
      .prepare(`
        INSERT INTO entities (id, kind, key, name, aliases, description, mention_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .run(id, kind, key, name, JSON.stringify(aliases), description, now, now)

    return {
      id,
      kind,
      key,
      name,
      aliases,
      description,
      mentionCount: 1,
      createdAt: now,
      updatedAt: now,
    }
  }

  link(memoryId: string, entityId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)')
      .run(memoryId, entityId)
  }

  byKey(key: string): Entity | undefined {
    const row = this.db.prepare('SELECT * FROM entities WHERE key = ?').get(normalizeKey(key)) as
      | EntityRow
      | undefined
    return row ? toEntity(row) : undefined
  }

  get(id: string): Entity | undefined {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as
      | EntityRow
      | undefined
    return row ? toEntity(row) : undefined
  }

  all(minMentions = 1): Entity[] {
    const rows = this.db
      .prepare('SELECT * FROM entities WHERE mention_count >= ? ORDER BY mention_count DESC')
      .all(minMentions) as EntityRow[]
    return rows.map(toEntity)
  }

  memoriesOf(entityId: string): string[] {
    return (
      this.db
        .prepare('SELECT memory_id FROM memory_entities WHERE entity_id = ?')
        .all(entityId) as Array<{ memory_id: string }>
    ).map((r) => r.memory_id)
  }

  entitiesOf(memoryId: string): Entity[] {
    const rows = this.db
      .prepare(`
        SELECT e.* FROM entities e
        JOIN memory_entities me ON me.entity_id = e.id
        WHERE me.memory_id = ?
      `)
      .all(memoryId) as EntityRow[]
    return rows.map(toEntity)
  }

  /** 实体 → 记忆 的全量映射，图谱构建时一次取完 */
  allLinks(): Array<{ memoryId: string; entityId: string }> {
    return (
      this.db.prepare('SELECT memory_id, entity_id FROM memory_entities').all() as Array<{
        memory_id: string
        entity_id: string
      }>
    ).map((r) => ({ memoryId: r.memory_id, entityId: r.entity_id }))
  }

  rename(id: string, name: string): void {
    this.db
      .prepare('UPDATE entities SET name = ?, key = ?, updated_at = ? WHERE id = ?')
      .run(name, normalizeKey(name), Date.now(), id)
  }

  /** 合并两个实体：把 from 的引用与别名并入 to，然后删掉 from */
  merge(fromId: string, toId: string): void {
    this.db.transaction(() => {
      const from = this.get(fromId)
      const to = this.get(toId)
      if (!from || !to) return
      const aliases = [...new Set([...to.aliases, from.name, ...from.aliases])]
      this.db
        .prepare('UPDATE entities SET aliases = ?, mention_count = mention_count + ? WHERE id = ?')
        .run(JSON.stringify(aliases), from.mentionCount, toId)
      this.db
        .prepare('UPDATE OR IGNORE memory_entities SET entity_id = ? WHERE entity_id = ?')
        .run(toId, fromId)
      this.db.prepare('DELETE FROM entities WHERE id = ?').run(fromId)
    })()
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id)
  }
}
