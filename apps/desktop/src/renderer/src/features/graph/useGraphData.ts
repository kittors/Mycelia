/**
 * 图谱的数据编排。
 *
 * 从 GraphView 里分出来 —— 那边负责把控件和画布接起来，这里只回答
 * 「这一屏该画哪些节点和边」。两者的改动理由不同：调整过滤规则不该
 * 牵动布局代码，反之亦然。
 */

import type { GraphSnapshot } from '@mycelia/shared'
import { useMemo } from 'react'
import { useAsync } from '../../shared/hooks/useAsync.js'

/**
 * 节点上限。
 *
 * 超过这个量级人眼已经看不出结构，只会看到一团毛球 —— 再多的点对理解
 * 没有增益，只是让每一帧更贵。真正的大库靠搜索和「最少连接数」收敛视野，
 * 而不是把十万个点一次性铺到屏幕上。
 */
export const MAX_NODES = 1200

export function useGraphData(options: {
  revision: number
  focusId: string | null
  minDegree: number
}) {
  const { revision, focusId, minDegree } = options

  const {
    data: snapshot,
    loading,
    reload,
  } = useAsync(
    () =>
      window.mycelia.getGraph({
        maxNodes: MAX_NODES,
        statuses: ['active', 'pending'],
        focusId: focusId ?? undefined,
      }),
    [revision, focusId],
  )

  const filtered = useMemo<GraphSnapshot | null>(() => {
    if (!snapshot) return null
    if (minDegree <= 0) return snapshot

    const kept = new Set(
      snapshot.nodes.filter((node) => node.degree >= minDegree).map((node) => node.id),
    )
    return {
      ...snapshot,
      nodes: snapshot.nodes.filter((node) => kept.has(node.id)),
      edges: snapshot.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    }
  }, [snapshot, minDegree])

  return { snapshot, filtered, loading, reload }
}
