/**
 * 记忆库统计。
 *
 * 全部实时聚合而不是维护计数器 —— 计数器会因为删除、状态流转而失真，
 * 而这些查询在十万条量级下也只要几毫秒。
 */

import type { Db } from '../db.js'
import type { MemoryStats } from './types.js'

/** 首页概览与 `myc stats` 共用同一份统计 */
export function collectStats(db: Db): MemoryStats {
  const total = (db.prepare('SELECT COUNT(*) n FROM memories').get() as { n: number }).n
  const group = (col: string) =>
    Object.fromEntries(
      (
        db.prepare(`SELECT ${col} k, COUNT(*) n FROM memories GROUP BY ${col}`).all() as Array<{
          k: string
          n: number
        }>
      ).map((r) => [r.k ?? 'unknown', r.n]),
    )

  const originGroup = (field: string) =>
    Object.fromEntries(
      (
        db
          .prepare(`
              SELECT json_extract(origin, '$.${field}') k, COUNT(*) n
              FROM memories WHERE k IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 30
            `)
          .all() as Array<{ k: string; n: number }>
      ).map((r) => [r.k ?? 'unknown', r.n]),
    )

  const range = db.prepare('SELECT MIN(created_at) a, MAX(created_at) b FROM memories').get() as {
    a: number | null
    b: number | null
  }

  return {
    total,
    byKind: group('kind'),
    byStatus: group('status'),
    bySensitivity: group('sensitivity'),
    byAgent: originGroup('agent'),
    byProject: originGroup('project'),
    pending: (
      db.prepare("SELECT COUNT(*) n FROM memories WHERE status = 'pending'").get() as {
        n: number
      }
    ).n,
    embedded: (db.prepare('SELECT COUNT(*) n FROM memory_vectors').get() as { n: number }).n,
    oldestAt: range.a,
    newestAt: range.b,
  }
}
