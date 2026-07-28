/**
 * 画布的命令式接口。
 *
 * 聚焦、取景、缩放、搜索这些操作由外部控件触发（工具栏按钮、搜索框、
 * 详情面板里的关联记忆），它们不适合走 props —— 那会变成「传一个
 * focusTarget 下来，画布再用 effect 去响应」，多一层状态还容易失步。
 *
 * 从 GraphCanvas 分出来是因为它和「建图、跑布局、管生命周期」是两件事：
 * 这里的每个方法都只是对当前渲染器做一次性动作，不涉及任何持有的状态。
 */

import type Graph from 'graphology'
import { type RefObject, useImperativeHandle } from 'react'
import type Sigma from 'sigma'
import { fitToNodes, focusOnNode, type Inset, zoomBy } from './canvas/camera.js'
import type { GraphCanvasHandle } from './GraphCanvas.js'

export function useCanvasHandle(
  ref: React.Ref<GraphCanvasHandle> | undefined,
  refs: {
    sigma: RefObject<Sigma | null>
    graph: RefObject<Graph | null>
    inset: RefObject<Inset>
    relayout: RefObject<() => void>
  },
) {
  const { sigma: sigmaRef, graph: graphRef, inset: insetRef, relayout: relayoutRef } = refs

  useImperativeHandle(ref, () => ({
    focusNode(id) {
      if (sigmaRef.current && graphRef.current?.hasNode(id)) {
        focusOnNode(sigmaRef.current, id, insetRef.current)
      }
    },
    focusCluster(cluster) {
      const renderer = sigmaRef.current
      const graph = graphRef.current
      if (!renderer || !graph) return
      fitToNodes(
        renderer,
        graph.filterNodes((_, attrs) => Number(attrs.cluster) === cluster),
        insetRef.current,
      )
    },
    resetView() {
      // 与布局收尾时同一套取景，「回到全图」才不会给出另一种视野
      const renderer = sigmaRef.current
      const graph = graphRef.current
      if (renderer && graph) fitToNodes(renderer, graph.nodes(), insetRef.current)
    },
    zoom(direction) {
      if (sigmaRef.current) zoomBy(sigmaRef.current, direction)
    },
    /**
     * 标签模糊匹配。
     *
     * 在内存里线性扫而不是建倒排索引：即便十万节点，一次 includes 扫描
     * 也在几毫秒量级，而搜索是低频操作。真到了需要索引的规模，
     * 瓶颈也早就不在这儿了。
     */
    hasNode(id) {
      return graphRef.current?.hasNode(id) ?? false
    },
    relayout() {
      relayoutRef.current()
    },
    search(text) {
      const graph = graphRef.current
      const needle = text.trim().toLowerCase()
      if (!graph || !needle) return []
      const found: Array<{ id: string; label: string; kind: string }> = []
      graph.forEachNode((id, attrs) => {
        if (found.length >= 50) return
        const label = String(attrs.label ?? '')
        if (label.toLowerCase().includes(needle)) {
          found.push({ id, label, kind: String(attrs.kind ?? '') })
        }
      })
      return found
    },
  }))
}
