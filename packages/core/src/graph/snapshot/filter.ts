/**
 * 聚焦裁剪。
 *
 * 用户点开某个节点时，只保留它 N 跳以内的邻域 ——
 * 整张图铺在眼前反而看不清「这条记忆和什么有关」。
 */

import type { MyceliaGraph } from './types.js'

/** 只保留起点 N 跳以内的节点，其余从图上删掉 */
export function keepNeighborhood(graph: MyceliaGraph, startId: string, depth: number): void {
  const keep = new Set<string>([startId])
  let frontier = [startId]

  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const node of frontier) {
      graph.forEachNeighbor(node, (neighbor: string) => {
        if (keep.has(neighbor)) return
        keep.add(neighbor)
        next.push(neighbor)
      })
    }
    frontier = next
    if (frontier.length === 0) break
  }

  for (const node of graph.nodes()) {
    if (!keep.has(node)) graph.dropNode(node)
  }
}
