/**
 * 布局坐标的持久化。
 *
 * 存下来是为了两件事，慢只是其中一件：
 *
 *   - 再次进入图谱不必重排（实测 3.8 秒 → 0.5 秒）
 *   - 位置保持不变。每次重排都会把用户刚建立的方位感抹掉 ——
 *     「那个簇在右上角」这种记忆一旦每次都不作数，图就失去了导航价值
 */

import type Graph from 'graphology'

export function saveLayout(graph: Graph): void {
  const points: Array<{ id: string; x: number; y: number }> = []
  graph.forEachNode((id, attrs) => {
    points.push({ id, x: Number(attrs.x) || 0, y: Number(attrs.y) || 0 })
  })
  void window.mycelia.saveGraphLayout(points)
}
