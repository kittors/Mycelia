/**
 * 快照 → graphology 图。
 *
 * 位置分三种来源，优先级从高到低：
 *
 *   1. 上次存下的坐标 —— 直接复用，图谱秒开且位置稳定
 *   2. 邻居的平均位置 —— 新增的记忆安置在它关联的那些节点旁边，
 *      比丢到画面中央再靠力导向拉回去自然得多
 *   3. 黄金角螺旋 —— 全新的图从这里起步。比随机撒点收敛快，
 *      也不会出现初始重叠导致力导向一开始就爆散
 */

import type { GraphSnapshot } from '@mycelia/shared'
import Graph from 'graphology'

export interface BuildResult {
  graph: Graph
  /** 没有已存坐标、需要参与布局的节点。空数组表示可以跳过力导向 */
  fresh: string[]
}

export function buildGraph(snapshot: GraphSnapshot, nodeSize = 1): BuildResult {
  const graph = new Graph()
  const fresh: string[] = []

  // 已有坐标的先放好，后面安置新节点时要拿它们当参照
  const placed = new Map<string, { x: number; y: number }>()
  for (const node of snapshot.nodes) {
    if (node.x !== undefined && node.y !== undefined) placed.set(node.id, { x: node.x, y: node.y })
  }

  /** 新节点落在它已知邻居的中心附近，稍加错开避免重叠 */
  const neighborsOf = new Map<string, string[]>()
  if (placed.size > 0) {
    for (const edge of snapshot.edges) {
      const from = neighborsOf.get(edge.source)
      if (from) from.push(edge.target)
      else neighborsOf.set(edge.source, [edge.target])
      const to = neighborsOf.get(edge.target)
      if (to) to.push(edge.source)
      else neighborsOf.set(edge.target, [edge.source])
    }
  }

  const golden = Math.PI * (3 - Math.sqrt(5))
  const spread = Math.sqrt(snapshot.nodes.length) * 4.2

  snapshot.nodes.forEach((node, index) => {
    const radius = Math.sqrt(index + 1) * 4.2
    let position = placed.get(node.id)

    if (!position) {
      fresh.push(node.id)
      const anchors = (neighborsOf.get(node.id) ?? [])
        .map((id) => placed.get(id))
        .filter((p): p is { x: number; y: number } => Boolean(p))

      if (anchors.length > 0) {
        const cx = anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length
        const cy = anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length
        // 用下标生成确定性的角度，同一批新节点不会叠在同一点
        const angle = index * golden
        position = {
          x: cx + Math.cos(angle) * spread * 0.04,
          y: cy + Math.sin(angle) * spread * 0.04,
        }
      } else {
        position = { x: Math.cos(index * golden) * radius, y: Math.sin(index * golden) * radius }
      }
    }

    graph.addNode(node.id, {
      x: position.x,
      y: position.y,
      label: node.label,
      /**
       * 半径按连接数算，不按重要度。
       *
       * 图上「大」应该意味着「连接多」—— 那是这张图能表达的东西，
       * 一眼就能找到枢纽。重要度是记忆自身的属性，跟图的结构无关，
       * 拿它定大小的结果是一个没有任何连接的孤点画得比枢纽还大，
       * 看图的人会被误导。开方是为了压住长尾：连接数常常相差两个数量级，
       * 线性映射会让枢纽大到盖住半张图。
       *
       * 这也是 d3-force 系图谱（Obsidian、Quartz）的通行做法。
       */
      size: Math.max(1.6, (2 + Math.sqrt(node.degree) * 1.9) * nodeSize),
      nodeType: node.type,
      kind: node.kind,
      cluster: node.cluster,
      degree: node.degree,
      status: node.status,
    })
  })

  for (const edge of snapshot.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
    if (graph.hasEdge(edge.id)) continue
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      size: Math.max(0.15, (0.4 + edge.weight * 1.1) * nodeSize),
      kind: edge.kind,
      weight: edge.weight,
      reason: edge.reason,
    })
  }

  return { graph, fresh }
}
