import type Graph from 'graphology'

/**
 * 把飞得太远的节点收回来。
 *
 * ForceAtlas2 里，没有任何边的节点只受斥力和引力 —— 别的节点靠边互相拉住，
 * 它没有，于是被一路推开。实测四个节点的图里，那个孤立节点跑到了距离
 * 主团一百倍远的地方。
 *
 * 后果不是「它自己不好看」，而是**整张图没法看**：取景要把所有节点收进视口，
 * 一个离群点就把包围盒撑大一百倍，剩下的节点全被压成中间一小团。
 *
 * 收回来时保留方向，只压缩距离 —— 方位感是图谱可读性的一部分，
 * 「那个孤立的在左下角」这个印象不该因为归置而消失。
 */

/** 超过中位距离的这么多倍就算离群 */
const OUTLIER_FACTOR = 2.4

/**
 * 收回到中位距离的这么多倍处。
 *
 * 2 倍是「明显在外圈、但和主团同框」的位置。压得更近（试过 1.6）
 * 并不会更好：孤立节点挤进主团反而让人以为它和别的有关系，
 * 而它恰恰是没有任何关联的那一个。
 */
const TARGET_FACTOR = 2

export function reelInOutliers(graph: Graph): number {
  const nodes = graph.nodes()
  if (nodes.length < 3) return 0

  let sumX = 0
  let sumY = 0
  for (const node of nodes) {
    sumX += graph.getNodeAttribute(node, 'x') as number
    sumY += graph.getNodeAttribute(node, 'y') as number
  }
  const cx = sumX / nodes.length
  const cy = sumY / nodes.length

  const distances = nodes.map((node) => {
    const dx = (graph.getNodeAttribute(node, 'x') as number) - cx
    const dy = (graph.getNodeAttribute(node, 'y') as number) - cy
    return Math.hypot(dx, dy)
  })

  /**
   * 用中位数而不是平均值。
   *
   * 平均值本身就会被离群点拉高 —— 一个跑到一百倍远的节点能把均值抬到
   * 谁都不超标的程度，于是什么都检测不出来。
   */
  const sorted = [...distances].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  if (median <= 0) return 0

  const limit = median * OUTLIER_FACTOR
  const target = median * TARGET_FACTOR
  let moved = 0

  nodes.forEach((node, index) => {
    const distance = distances[index] ?? 0
    if (distance <= limit) return

    const dx = (graph.getNodeAttribute(node, 'x') as number) - cx
    const dy = (graph.getNodeAttribute(node, 'y') as number) - cy
    const scale = target / distance
    graph.setNodeAttribute(node, 'x', cx + dx * scale)
    graph.setNodeAttribute(node, 'y', cy + dy * scale)
    moved++
  })

  return moved
}
