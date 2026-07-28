/**
 * 数据库迁移。
 *
 * 迁移只增不改：每条按 version 顺序执行一次，执行记录写在 schema_migrations 里。
 * 绝不允许修改已发布的迁移 —— 用户库里跑过的不会重放，改了只会让新旧库分叉。
 * 要调整结构就追加新版本。
 */

import type { Database } from 'better-sqlite3'
import { migration as m001 } from './001-initial-schema.js'
import { migration as m002 } from './002-file-knowledge-base.js'
import { migration as m003 } from './003-capture-provenance.js'
import { migration as m004 } from './004-graph-layout.js'
import type { Migration } from './types.js'

export type { Migration }

/** 按 version 升序，新迁移追加在末尾 */
export const MIGRATIONS: Migration[] = [m001, m002, m003, m004]

export function runMigrations(db: Database): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: number }).version),
  )

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )

  let count = 0
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    // 每条迁移单独一个事务：失败时不会留下半成品 schema
    db.transaction(() => {
      db.exec(m.up)
      insert.run(m.version, m.name, Date.now())
    })()
    count++
  }
  return count
}
