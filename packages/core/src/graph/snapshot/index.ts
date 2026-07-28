/**
 * 图谱快照生成。
 *
 * 记忆节点与实体节点画在同一张图上。这是「能看出神经簇」的关键 ——
 * 光靠记忆之间的语义相似度，簇结构是模糊的；
 * 一旦把「server-hk-01」这样的实体也变成节点，所有跟它相关的记忆
 * 会自然向它塌缩，形成肉眼可辨的星团。
 */

import type { GraphConfig, GraphEdge, GraphNode, GraphSnapshot } from '@mycelia/shared'
import { clamp, createLogger, truncate } from '@mycelia/shared'
import type { MyceliaStore } from '@mycelia/store'
import { UndirectedGraph } from 'graphology'
import { labelClusters, louvain } from './cluster.js'
import { keepNeighborhood } from './filter.js'
import { selectConnected } from './select.js'
import type { EdgeAttrs, MyceliaGraph, NodeAttrs, SnapshotOptions } from './types.js'

export type { SnapshotOptions } from './types.js'

const log = createLogger('core:snapshot')

/**
 * 生成前端可直接渲染的图谱快照。
 *
 * 记忆节点与实体节点画在同一张图上。这是「能看出神经簇」的关键 ——
 * 光靠记忆之间的语义相似度，簇结构是模糊的；
 * 一旦把「server-hk-01」这样的实体也变成节点，所有跟它相关的记忆
 * 会自然向它塌缩，形成肉眼可辨的星团。
 */
export function buildSnapshot(
  store: MyceliaStore,
  config: GraphConfig,
  opts: SnapshotOptions = {},
): GraphSnapshot {
  const started = Date.now()
  const includeEntities = opts.includeEntities ?? config.includeEntities
  const maxNodes = opts.maxNodes ?? 3000

  const filter = {
    tags: opts.tags,
    project: opts.project,
    kinds: opts.kinds,
    since: opts.since,
    status: opts.statuses ?? ['active'],
  }

  const allEdges = store.edges.all()
  const memories = selectConnected(store, filter, allEdges, maxNodes, opts.focusId)
  const memoryIds = new Set(memories.map((m) => m.id))
  const graph: MyceliaGraph = new UndirectedGraph<NodeAttrs, EdgeAttrs>()

  // ── 记忆节点 ──
  for (const m of memories) {
    graph.addNode(m.id, {
      type: 'memory',
      label: m.title,
      kind: m.kind,
      importance: m.importance,
      pinned: m.pinned,
      sensitivity: m.sensitivity,
      status: m.status,
      tags: m.tags,
      project: m.origin.project,
      updatedAt: m.updatedAt,
      accessCount: m.accessCount,
    })
  }

  // ── 记忆之间的边 ──
  for (const e of allEdges) {
    if (!memoryIds.has(e.sourceId) || !memoryIds.has(e.targetId)) continue
    if (graph.hasEdge(e.sourceId, e.targetId)) {
      // 同一对节点有多种关系时，取最强的那条作为展示权重
      const cur = graph.getEdgeAttribute(e.sourceId, e.targetId, 'weight') as number
      if (e.weight > cur) {
        graph.setEdgeAttribute(e.sourceId, e.targetId, 'weight', e.weight)
        graph.setEdgeAttribute(e.sourceId, e.targetId, 'kind', e.kind)
        graph.setEdgeAttribute(e.sourceId, e.targetId, 'reason', e.reason ?? '')
      }
      continue
    }
    graph.addEdge(e.sourceId, e.targetId, {
      id: e.id,
      kind: e.kind,
      weight: e.weight,
      reason: e.reason ?? '',
    })
  }

  // ── 实体节点 ──
  if (includeEntities) {
    const links = store.entities.allLinks()
    const byEntity = new Map<string, string[]>()
    for (const link of links) {
      if (!memoryIds.has(link.memoryId)) continue
      const arr = byEntity.get(link.entityId)
      if (arr) arr.push(link.memoryId)
      else byEntity.set(link.entityId, [link.memoryId])
    }

    for (const entity of store.entities.all()) {
      const linked = byEntity.get(entity.id)
      // 只连着一条记忆的实体不值得画：它只会变成一个孤零零的挂件
      if (!linked || linked.length < 2) continue
      if (graph.order >= maxNodes * 1.4) break

      graph.addNode(entity.id, {
        type: 'entity',
        label: entity.name,
        kind: entity.kind,
        mentionCount: entity.mentionCount,
        tags: [],
      })
      for (const memId of linked) {
        if (graph.hasEdge(entity.id, memId)) continue
        graph.addEdge(entity.id, memId, {
          id: `${entity.id}-${memId}`,
          kind: 'entity',
          weight: 0.6,
          reason: `提及 ${entity.name}`,
        })
      }
    }
  }

  // ── 聚焦模式：只保留目标节点的 N 跳邻域 ──
  if (opts.focusId && graph.hasNode(opts.focusId)) {
    keepNeighborhood(graph, opts.focusId, opts.focusDepth ?? 2)
  }

  // ── 社区检测：这就是「神经簇」 ──
  let communities: Record<string, number> = {}
  if (graph.order > 2 && graph.size > 0) {
    try {
      communities = louvain(graph, {
        resolution: config.clusterResolution,
        getEdgeWeight: 'weight',
      })
    } catch (e) {
      log.warn(`社区检测失败，全部归入同一簇：${String(e)}`)
    }
  }

  // ── 输出 ──
  const nodes: GraphNode[] = []
  const clusterMembers = new Map<number, string[]>()

  // 上次算好的坐标，有就带出去给前端复用，省掉一次全量重排
  const saved = store.layout.get(graph.nodes())

  graph.forEachNode((id, attrs) => {
    const cluster = communities[id] ?? 0
    const degree = graph.degree(id)
    const isEntity = attrs.type === 'entity'

    // 节点大小：记忆看重要度与被访问次数，实体看被提及广度
    const rawSize = isEntity
      ? 0.35 + Math.min(0.65, Math.log2((attrs.mentionCount as number) + 1) / 6)
      : 0.25 +
        (attrs.importance as number) * 0.4 +
        Math.min(0.2, degree / 25) +
        Math.min(0.15, Math.log2((attrs.accessCount as number) + 1) / 12)

    nodes.push({
      id,
      type: isEntity ? 'entity' : 'memory',
      label: truncate(String(attrs.label ?? ''), 42),
      kind: String(attrs.kind ?? ''),
      size: clamp(attrs.pinned ? rawSize + 0.15 : rawSize, 0.2, 1),
      cluster,
      ...saved.get(id),
      sensitivity: attrs.sensitivity as string | undefined,
      status: attrs.status as string | undefined,
      tags: (attrs.tags as string[]) ?? [],
      degree,
      updatedAt: attrs.updatedAt as number | undefined,
    })

    const arr = clusterMembers.get(cluster)
    if (arr) arr.push(id)
    else clusterMembers.set(cluster, [id])
  })

  const edges: GraphEdge[] = []
  graph.forEachEdge((_key, attrs, source, target) => {
    edges.push({
      id: String(attrs.id ?? `${source}-${target}`),
      source,
      target,
      kind: String(attrs.kind ?? 'semantic'),
      weight: Number(attrs.weight ?? 0.5),
      reason: attrs.reason ? String(attrs.reason) : undefined,
    })
  })

  const clusters = labelClusters(graph, clusterMembers)

  log.debug(
    `图谱快照：${nodes.length} 节点 / ${edges.length} 边 / ${clusters.length} 簇，耗时 ${Date.now() - started}ms`,
  )

  return {
    nodes,
    edges,
    clusters,
    stats: {
      memoryCount: nodes.filter((n) => n.type === 'memory').length,
      entityCount: nodes.filter((n) => n.type === 'entity').length,
      edgeCount: edges.length,
      clusterCount: clusters.length,
    },
  }
}
