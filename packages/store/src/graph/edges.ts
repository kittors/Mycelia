/**
 * 边仓储。
 *
 * 边是知识图谱的连接：语义相似、共享实体、共享标签、同次会话产生。
 * 同一对节点的同类边只保留一条，权重取更高者 —— 反复摄取不会让图越来越乱。
 */

import type { Edge, EdgeInput, EdgeKind } from '@mycelia/shared'
import { EdgeKind as EdgeKindSchema, newId } from '@mycelia/shared'
import type { Db } from '../db.js'
import { type EdgeRow, toEdge } from './types.js'

export class EdgeRepo {
  constructor(private readonly db: Db) {}

  upsert(input: EdgeInput): Edge {
    /**
     * kind 必须校验。
     *
     * 这一列没有数据库约束，写进去什么都收得下。而下游（图谱的边类型过滤）
     * 是按枚举白名单匹配的 —— 拼错一个字母，边就静默地从界面上消失了：
     * 查库查得到、统计数得着，就是画不出来，排查起来毫无头绪。
     * 宁可在写入时就炸掉。
     */
    const kind = EdgeKindSchema.safeParse(input.kind)
    if (!kind.success) {
      throw new Error(`未知的关联类型：${String(input.kind)}`)
    }

    const now = Date.now()
    const id = newId('edg')
    // 同一对节点的同类边只保留一条，权重取更高者 —— 反复摄取不会让图越来越乱
    this.db
      .prepare(`
        INSERT INTO edges (id, source_id, target_id, kind, weight, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, target_id, kind) DO UPDATE SET
          weight = MAX(weight, excluded.weight),
          reason = COALESCE(excluded.reason, reason)
      `)
      .run(
        id,
        input.sourceId,
        input.targetId,
        input.kind,
        input.weight ?? 0.5,
        input.reason ?? null,
        now,
      )

    const row = this.db
      .prepare('SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND kind = ?')
      .get(input.sourceId, input.targetId, input.kind) as EdgeRow
    return toEdge(row)
  }

  upsertMany(inputs: readonly EdgeInput[]): number {
    if (inputs.length === 0) return 0
    const stmt = this.db.prepare(`
      INSERT INTO edges (id, source_id, target_id, kind, weight, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id, kind) DO UPDATE SET
        weight = MAX(weight, excluded.weight),
        reason = COALESCE(excluded.reason, reason)
    `)
    const now = Date.now()
    let n = 0
    this.db.transaction(() => {
      for (const e of inputs) {
        if (e.sourceId === e.targetId) continue
        stmt.run(
          newId('edg'),
          e.sourceId,
          e.targetId,
          e.kind,
          e.weight ?? 0.5,
          e.reason ?? null,
          now,
        )
        n++
      }
    })()
    return n
  }

  /** 取某个节点的邻居，按权重降序 */
  neighbors(nodeId: string, limit = 20): Edge[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM edges
        WHERE source_id = ? OR target_id = ?
        ORDER BY weight DESC LIMIT ?
      `)
      .all(nodeId, nodeId, limit) as EdgeRow[]
    return rows.map(toEdge)
  }

  all(kinds?: readonly EdgeKind[]): Edge[] {
    if (!kinds?.length) {
      return (this.db.prepare('SELECT * FROM edges').all() as EdgeRow[]).map(toEdge)
    }
    const rows = this.db
      .prepare(`SELECT * FROM edges WHERE kind IN (${kinds.map(() => '?').join(',')})`)
      .all(...kinds) as EdgeRow[]
    return rows.map(toEdge)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM edges WHERE id = ?').run(id)
  }

  /** 删除某条记忆自动生成的边（重算前先清场，避免陈旧边堆积） */
  removeAutoEdgesFor(memoryId: string): void {
    this.db
      .prepare(`
        DELETE FROM edges
        WHERE (source_id = ? OR target_id = ?) AND kind IN ('semantic','tag','session','project')
      `)
      .run(memoryId, memoryId)
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) n FROM edges').get() as { n: number }).n
  }
}
