/**
 * 图谱布局坐标的读写。
 *
 * 只是一层薄薄的持久化：算好的坐标存下来，下次进图谱直接复用，
 * 免得同一份数据反复重排（既慢，又让人无法在图上建立方位感）。
 */

import type { Db } from '../db.js'

export interface LayoutPoint {
  x: number
  y: number
}

interface LayoutRow {
  memory_id: string
  x: number
  y: number
}

export class LayoutRepo {
  constructor(private readonly db: Db) {}

  /** 取一批节点的坐标。缺失的不出现在结果里，由调用方决定怎么安置 */
  get(ids: readonly string[]): Map<string, LayoutPoint> {
    const result = new Map<string, LayoutPoint>()
    if (ids.length === 0) return result

    /**
     * 分批查询。
     *
     * SQLite 的变量数上限默认是 999，一次塞进上千个 id 会直接报错 ——
     * 而图谱恰恰动辄上千个节点。
     */
    const CHUNK = 800
    const statement = (count: number) =>
      this.db.prepare(
        `SELECT memory_id, x, y FROM graph_layout WHERE memory_id IN (${Array(count).fill('?').join(',')})`,
      )

    for (let offset = 0; offset < ids.length; offset += CHUNK) {
      const slice = ids.slice(offset, offset + CHUNK)
      const rows = statement(slice.length).all(...slice) as LayoutRow[]
      for (const row of rows) result.set(row.memory_id, { x: row.x, y: row.y })
    }
    return result
  }

  /** 批量写入。布局跑完、以及用户拖动节点之后调用 */
  save(points: ReadonlyMap<string, LayoutPoint>): void {
    if (points.size === 0) return
    const now = Date.now()
    const statement = this.db.prepare(`
      INSERT INTO graph_layout (memory_id, x, y, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at
    `)
    this.db.transaction(() => {
      for (const [id, point] of points) statement.run(id, point.x, point.y, now)
    })()
  }

  /** 清空。用户主动要求「重新布局」时用 */
  clear(): void {
    this.db.prepare('DELETE FROM graph_layout').run()
  }
}
