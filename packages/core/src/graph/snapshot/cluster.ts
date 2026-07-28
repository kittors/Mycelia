/**
 * 社区发现与簇命名。
 *
 * Louvain 把图切成若干「神经簇」，但簇只有编号是没用的 ——
 * 用户看到的应该是「基础设施」「前端」这样的名字。
 * labelClusters 从簇内高频标签和实体反推出这个名字。
 */

import type { GraphSnapshot } from '@mycelia/shared'
import { truncate } from '@mycelia/shared'
import louvainModule from 'graphology-communities-louvain'
import type { MyceliaGraph } from './types.js'

/**
 * graphology-communities-louvain 的类型声明写成 ESM（export default），
 * 运行时却是 CJS（module.exports = fn）。NodeNext 下两者对不上，
 * 这里用一次断言把它掰正，避免污染调用处。
 */
export const louvain = louvainModule as unknown as (
  graph: unknown,
  options?: { resolution?: number; getEdgeWeight?: string },
) => Record<string, number>

/**
 * 给每个簇起名字。
 *
 * 一堆彩色圆点没有意义，用户需要知道「这团紫色的是什么」。
 * 优先用簇内最有代表性的标签；没有标签就退回到最显眼的实体名。
 */
export function labelClusters(
  graph: MyceliaGraph,
  members: Map<number, string[]>,
): GraphSnapshot['clusters'] {
  const out: GraphSnapshot['clusters'] = []
  // 记录每个候选名字被用过几次 —— 重名的簇必须区分开，
  // 否则侧栏里五个「ops」用户根本不知道点哪个
  const nameUsage = new Map<string, number>()

  // 按规模从大到小命名：大簇优先拿到干净的名字，小簇才去消歧
  const ordered = [...members.entries()].sort((a, b) => b[1].length - a[1].length)

  for (const [id, nodeIds] of ordered) {
    const tagCount = new Map<string, number>()
    const projectCount = new Map<string, number>()
    const entityCandidates: Array<{ name: string; degree: number }> = []

    for (const nodeId of nodeIds) {
      const attrs = graph.getNodeAttributes(nodeId)
      if (attrs.type === 'entity') {
        entityCandidates.push({ name: String(attrs.label), degree: graph.degree(nodeId) })
        continue
      }
      if (attrs.project) projectCount.set(attrs.project, (projectCount.get(attrs.project) ?? 0) + 1)
      for (const tag of (attrs.tags as string[]) ?? []) {
        // 用一级标签做簇名更稳：infra/ssh 和 infra/docker 应该归到「infra」
        const top = tag.split('/')[0]!
        tagCount.set(top, (tagCount.get(top) ?? 0) + 1)
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 0.5)
      }
    }

    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
    const topEntity = entityCandidates.sort((a, b) => b.degree - a.degree)[0]
    const topProject = [...projectCount.entries()].sort((a, b) => b[1] - a[1])[0]
    const tagCoverage = topTags[0] ? (tagCount.get(topTags[0]) ?? 0) / nodeIds.length : 0
    const projectCoverage = topProject ? topProject[1] / nodeIds.length : 0

    let label = topTags[0] ?? topEntity?.name ?? topProject?.[0] ?? `簇 ${id}`
    // 标签只覆盖少数节点时，它不适合作为整团知识的名字。
    // 优先使用共享实体，其次使用覆盖过半的项目名。
    if (tagCoverage < 0.3) {
      if (topEntity) label = topEntity.name
      else if (projectCoverage >= 0.5 && topProject) label = topProject[0]
    }

    // 重名消解：优先换用次级标签（ops → ops/command），
    // 实在没得换才退回代表节点的标题
    const used = nameUsage.get(label) ?? 0
    if (used > 0) {
      const alternative = topTags.find((t) => t !== label && !nameUsage.has(t))
      if (alternative) {
        label = alternative
      } else {
        const anchor = nodeIds
          .map((n) => ({ id: n, degree: graph.degree(n) }))
          .sort((a, b) => b.degree - a.degree)[0]
        const anchorLabel = anchor ? String(graph.getNodeAttribute(anchor.id, 'label')) : ''
        label = anchorLabel ? `${label} · ${truncate(anchorLabel, 16)}` : `${label} ${used + 1}`
      }
    }
    nameUsage.set(label, (nameUsage.get(label) ?? 0) + 1)

    out.push({
      id,
      label,
      size: nodeIds.length,
      topTags: topTags.slice(0, 5),
    })
  }

  return out.sort((a, b) => b.size - a.size)
}
