import type { GraphSnapshot } from '@mycelia/shared'
import type Graph from 'graphology'
import { useEffect, useRef } from 'react'
import type Sigma from 'sigma'
import { buildGraph } from './canvas/build.js'
import type { Inset } from './canvas/camera.js'
import { type ClusterLayer, createClusterLayer } from './canvas/cluster-layer.js'
import { applyHighlight, type ColorMode } from './canvas/highlight.js'
import { type IdleMotion, startIdleMotion } from './canvas/idle.js'
import { bindInteractions, type HoveredNode } from './canvas/interactions.js'
import { runLayout } from './canvas/layout.js'
import { saveLayout } from './canvas/persist.js'
import { computeProminence, NO_PROMINENCE } from './canvas/prominence.js'
import { createRenderer } from './canvas/renderer.js'
import { profileFor } from './canvas/scale.js'
import { graphUnit } from './canvas/unit.js'
import { fadeEdge, type GraphPalette, readPalette } from './graph-theme.js'
import { useCanvasHandle } from './useCanvasHandle.js'
import { useContainerReady } from './useContainerReady.js'

export type { ColorMode } from './canvas/highlight.js'

export interface GraphCanvasHandle {
  focusNode(id: string): void
  focusCluster(cluster: number): void
  resetView(): void
  zoom(direction: 1 | -1): void
  /** 按标签搜索，返回命中的节点 id */
  search(text: string): Array<{ id: string; label: string; kind: string }>
  /** 该节点是否在当前渲染的子图里 */
  hasNode(id: string): boolean
  /** 就地重排。不重建渲染器，节点从当前位置逐帧移到新位置 */
  relayout(): void
}

export interface GraphCanvasProps {
  snapshot: GraphSnapshot
  /** 允许显示的边类型 */
  edgeKinds: ReadonlySet<string>
  colorMode: ColorMode
  /** 当前选中的节点，由外部（列表/检索）驱动 */
  selectedId: string | null
  onSelect: (id: string | null) => void
  onHover: (node: HoveredNode | null) => void
  /** 主题变化时重新取色 */
  themeKey: string
  /**
   * 画布右侧被浮层遮住的宽度。
   *
   * 详情面板浮在画布上而不是把它挤窄 —— 挤窄会触发 Sigma 的 resize，
   * 相机比例不变但视口变了，画面里所有节点会瞬间平移一大段，
   * 表现就是「关掉面板过一会儿节点突然跳了」。画布尺寸恒定就没有这回事，
   * 代价是右边一条被盖住，所以取景时要把它算进去。
   */
  insetRight?: number
  /** 高亮但不选中的一组节点，用于搜索结果预览 */
  spotlight?: ReadonlySet<string> | null
  ref?: React.Ref<GraphCanvasHandle>
}

/**
 * 知识图谱画布。
 *
 * 这个组件只负责「把各部分接起来并管好生命周期」，具体职责都在 canvas/ 下：
 *
 *   build.ts         快照 → graphology
 *   layout.ts        分帧力导向
 *   highlight.ts     焦点与淡出
 *   interactions.ts  悬停、点击、拖拽
 *   camera.ts        视野控制
 *
 * 关键设计：轻量 props（边过滤、着色、选中）走 ref + reducer 刷新，
 * 不进重建 effect 的依赖。否则每点一个节点都要重跑力导向，图会整个跳一下。
 */
export function GraphCanvas({
  snapshot,
  edgeKinds,
  colorMode,
  selectedId,
  onSelect,
  onHover,
  themeKey,
  insetRight = 0,
  spotlight = null,
  ref,
}: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const paletteRef = useRef<GraphPalette>(readPalette())
  const clusterLayerRef = useRef<ClusterLayer | null>(null)
  const idleRef = useRef<IdleMotion | null>(null)
  /** 就地重排用。存起来是为了不必把整个 effect 的局部变量都提出去 */
  const relayoutRef = useRef<() => void>(() => undefined)
  // 容器没尺寸时先别建渲染器，原因见 useContainerReady
  const containerReady = useContainerReady(container)

  // 这些值在 Sigma 的 reducer 里被读取，用 ref 而不是闭包捕获
  const edgeKindsRef = useRef(edgeKinds)
  const colorModeRef = useRef(colorMode)
  const selectedRef = useRef(selectedId)
  const hoveredRef = useRef<string | null>(null)
  const neighborsRef = useRef<Set<string> | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)
  const spotlightRef = useRef(spotlight)

  // inset 用 ref 读：它每次开合面板都在变，进重建依赖会把整张图重跑一遍
  const insetRef = useRef<Inset>({ right: insetRight })
  insetRef.current = { right: insetRight }

  const onSelectRef = useRef(onSelect)
  const onHoverRef = useRef(onHover)
  onSelectRef.current = onSelect
  onHoverRef.current = onHover

  useCanvasHandle(ref, {
    sigma: sigmaRef,
    graph: graphRef,
    inset: insetRef,
    relayout: relayoutRef,
  })

  // ── 同步轻量 props：不重建渲染器，只刷新 reducer ──
  useEffect(() => {
    edgeKindsRef.current = edgeKinds
    refreshRef.current()
  }, [edgeKinds])

  useEffect(() => {
    colorModeRef.current = colorMode
    // 轮廓只在按簇着色时出现：按类型着色时同一个圈里颜色各异，画个圈只会让人困惑
    clusterLayerRef.current?.setVisible(colorMode === 'cluster')
    refreshRef.current()
  }, [colorMode])

  useEffect(() => {
    spotlightRef.current = spotlight
    refreshRef.current()
  }, [spotlight])

  useEffect(() => {
    selectedRef.current = selectedId
    const graph = graphRef.current
    neighborsRef.current =
      selectedId && graph?.hasNode(selectedId) ? new Set(graph.neighbors(selectedId)) : null
    refreshRef.current()
  }, [selectedId])

  // ── 建图与渲染。只在数据或主题变化时重建 ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: 重建代价极高，依赖是刻意收窄的
  useEffect(() => {
    if (!container.current || snapshot.nodes.length === 0 || !containerReady) return

    const palette = readPalette()
    paletteRef.current = palette
    const dark = document.documentElement.dataset.theme === 'dark'

    // 渲染参数按节点规模分档，见 canvas/scale.ts
    const profile = profileFor(snapshot.nodes.length, snapshot.edges.length)
    const { graph, fresh } = buildGraph(snapshot, profile.nodeSize)
    const persistLayout = () => saveLayout(graph)

    /**
     * 布局落定后的收尾：存坐标，然后交棒给静息律动。
     *
     * 律动只在中小规模开 —— 大图上每秒几十次全量更新坐标不划算，
     * 而且那个密度下也看不出单个节点在动。
     */
    const settle = () => {
      persistLayout()
      idleRef.current?.stop()
      idleRef.current = profile.idleMotion
        ? startIdleMotion(graph, renderer, graphUnit(graph))
        : null
    }
    const prominence = computeProminence(snapshot)
    // 边在无焦点时的底色：直接把浓淡烘进颜色，避免每帧再算一次混色
    const restingEdgeColor = fadeEdge(palette, profile.edgeAlpha, dark)

    const renderer = createRenderer(graph, container.current, palette, profile)
    sigmaRef.current = renderer
    graphRef.current = graph

    const refresh = () => {
      const focus = selectedRef.current ?? hoveredRef.current
      const neighbors = focus
        ? focus === selectedRef.current
          ? neighborsRef.current
          : new Set(graph.neighbors(focus))
        : null

      applyHighlight(renderer, graph, palette, dark, {
        prominence: colorModeRef.current === 'cluster' ? prominence : NO_PROMINENCE,
        restingEdgeColor,
        spotlight: spotlightRef.current,
        focus,
        neighbors,
        edgeKinds: edgeKindsRef.current,
        colorMode: colorModeRef.current,
      })
    }

    refreshRef.current = refresh
    refresh()

    const clusterLayer = createClusterLayer(
      renderer,
      graph,
      container.current,
      dark,
      profile.clusterHulls,
      prominence,
    )
    clusterLayer.setVisible(colorModeRef.current === 'cluster')
    clusterLayerRef.current = clusterLayer

    /**
     * 全部节点都有存好的坐标就跳过布局。
     *
     * 这是「每次进图谱都要等几秒」的正解：数据没变就不该重算。
     * 更重要的是位置保持稳定 —— 每次重排都会把用户刚建立的方位感抹掉。
     */
    const layout = runLayout(graph, renderer, profile, () => insetRef.current, {
      skip: fresh.length === 0,
      // 只新增了少量节点时跑个短一些的布局，让它们落位即可，不必重排全图
      partial: fresh.length > 0 && fresh.length < snapshot.nodes.length * 0.2,
      onSettled: settle,
    })

    /**
     * 就地重排。
     *
     * 不走「清空坐标 → 重新取数据 → 重建渲染器」那条路：那样图会先消失
     * 再整个蹦出来，中间是一段空白。这里保留渲染器，让力导向从当前位置
     * 开始重新演算 —— 节点逐帧移动到新位置，过程本身就是动画。
     */
    relayoutRef.current = () => {
      idleRef.current?.stop()
      idleRef.current = null
      layout.stop()
      runLayout(graph, renderer, profile, () => insetRef.current, {
        onSettled: settle,
      })
    }

    // 布局期间坐标每帧都在变，凸包缓存必须跟着失效；停下来之后就不用再算了
    const invalidateWhileLayouting = () => {
      if (layout.running()) clusterLayer.invalidate()
    }
    renderer.on('beforeRender', invalidateWhileLayouting)
    const interactions = bindInteractions(renderer, graph, container.current, {
      onSelect: (id) => onSelectRef.current(id),
      onHover: (node) => onHoverRef.current(node),
      onGeometryChange: () => clusterLayer.invalidate(),
      // 拖拽和律动都在改坐标，同时跑会互相打架 —— 让律动先退场
      onDragStart: () => idleRef.current?.stop(),
      onLayoutChanged: () => {
        persistLayout()
        // 拖过之后基准位置变了，律动得重新采样，否则节点会被拉回旧位置
        idleRef.current?.resync()
      },
      refresh,
      hasSelection: () => selectedRef.current !== null,
      setHovered: (id) => {
        hoveredRef.current = id
      },
    })

    return () => {
      idleRef.current?.stop()
      idleRef.current = null
      layout.stop()
      renderer.off('beforeRender', invalidateWhileLayouting)
      clusterLayer.dispose()
      clusterLayerRef.current = null
      interactions.dispose()
      refreshRef.current = () => undefined
      sigmaRef.current = null
      graphRef.current = null
      renderer.kill()
    }
  }, [snapshot, themeKey, containerReady])

  return <div ref={container} className="absolute inset-0" />
}
