import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '@mycelia/shared'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations/index.js'

const log = createLogger('store:db')

export type Db = Database.Database

export interface OpenOptions {
  path: string
  readonly?: boolean
}

/**
 * 打开数据库连接。
 *
 * WAL 是这里最关键的一行：它让 Electron 主进程、CLI、MCP server 三个独立进程
 * 能同时读写同一个库，读不阻塞写。这也是本项目不需要常驻 daemon 的原因 ——
 * SQLite 本身就是进程间通信层。
 */
export function openDatabase(opts: OpenOptions): Db {
  mkdirSync(dirname(opts.path), { recursive: true })

  const db = new Database(opts.path, { readonly: opts.readonly ?? false })

  db.pragma('journal_mode = WAL')
  // NORMAL 在 WAL 下已经足够安全（崩溃最多丢最后一个事务），比 FULL 快一个数量级
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  // 并发写时最多等 5 秒再抛 SQLITE_BUSY，避免多进程互踩
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')
  // 64MB 页缓存：向量与 FTS 查询受益明显
  db.pragma('cache_size = -64000')
  db.pragma('mmap_size = 268435456')

  if (!opts.readonly) {
    const applied = runMigrations(db)
    if (applied > 0) log.info(`已应用 ${applied} 条数据库迁移`)
  }

  return db
}

/** 读取/写入 meta 表的小工具 */
export function getMeta(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

/**
 * 抢占式租约。
 * 摄取流水线是重活，多个进程同时跑会重复消耗 LLM 配额。
 * 谁抢到租约谁干活，租约过期后其他进程可以接管（避免进程崩溃后永久卡死）。
 */
export function acquireLease(db: Db, name: string, owner: string, ttlMs: number): boolean {
  const now = Date.now()
  const expires = now + ttlMs
  const result = db
    .prepare(`
      INSERT INTO leases (name, owner, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
      WHERE leases.owner = excluded.owner OR leases.expires_at < ?
    `)
    .run(name, owner, expires, now)
  return result.changes > 0
}

export function releaseLease(db: Db, name: string, owner: string): void {
  db.prepare('DELETE FROM leases WHERE name = ? AND owner = ?').run(name, owner)
}
