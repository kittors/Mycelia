/**
 * 标签仓储。
 *
 * 标签存在记忆行的 JSON 数组里，tags 表只放元数据（颜色、显示名）。
 * 统计一律实时算 —— tags.count 这个计数器会因为记忆被删而失真。
 */

import type { Db } from '../db.js'
import { safeParse } from '../rows.js'

export class TagRepo {
  constructor(private readonly db: Db) {}

  /** 实时统计，而不是读 tags.count —— 计数器会因为删除记忆而失真 */
  usage(): Array<{ tag: string; count: number; color?: string; label?: string }> {
    const rows = this.db
      .prepare(`
        SELECT json_each.value AS tag, COUNT(*) AS n
        FROM memories, json_each(memories.tags)
        WHERE memories.status = 'active'
        GROUP BY tag ORDER BY n DESC
      `)
      .all() as Array<{ tag: string; n: number }>

    const meta = new Map(
      (
        this.db.prepare('SELECT tag, color, label FROM tags').all() as Array<{
          tag: string
          color: string | null
          label: string | null
        }>
      ).map((r) => [r.tag, r]),
    )

    return rows.map((r) => ({
      tag: r.tag,
      count: r.n,
      color: meta.get(r.tag)?.color ?? undefined,
      label: meta.get(r.tag)?.label ?? undefined,
    }))
  }

  setMeta(tag: string, patch: { color?: string; label?: string; description?: string }): void {
    this.db
      .prepare(`
        INSERT INTO tags (tag, color, label, description, count, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(tag) DO UPDATE SET
          color = COALESCE(excluded.color, color),
          label = COALESCE(excluded.label, label),
          description = COALESCE(excluded.description, description)
      `)
      .run(tag, patch.color ?? null, patch.label ?? null, patch.description ?? null, Date.now())
  }

  rename(from: string, to: string): number {
    // JSON 数组里的标签重命名：整体替换后写回
    const rows = this.db
      .prepare(
        'SELECT id, tags FROM memories WHERE EXISTS (SELECT 1 FROM json_each(memories.tags) WHERE json_each.value = ?)',
      )
      .all(from) as Array<{ id: string; tags: string }>
    const stmt = this.db.prepare('UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?')
    const now = Date.now()
    this.db.transaction(() => {
      for (const r of rows) {
        const tags = safeParse<string[]>(r.tags, []).map((t) => (t === from ? to : t))
        stmt.run(JSON.stringify([...new Set(tags)]), now, r.id)
      }
    })()
    return rows.length
  }
}
