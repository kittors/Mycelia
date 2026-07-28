import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemoryDetail } from '../../../../shared/ipc-contract.js'
import { DEFAULT_EDGE_KINDS } from '../../shared/lib/labels.js'
import { Button, Empty, Icon, Spinner } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'
import { MemoryInspector } from '../memories/MemoryInspector.js'
import { type ColorMode, GraphCanvas, type GraphCanvasHandle } from './GraphCanvas.js'
import {
  GraphHoverCard,
  GraphStatsPanel,
  GraphToolbar,
  GraphZoomControls,
} from './GraphControls.js'
import { GraphSearch } from './GraphSearch.js'
import { useGraphData } from './useGraphData.js'

/** 详情面板宽度。画布取景要避开这一条，见 GraphCanvas 的 insetRight */
const INSPECTOR_WIDTH = 340

export function GraphView() {
  const revision = useApp((s) => s.revision)
  const theme = useApp((s) => s.theme)
  const app = useApp()

  const canvasRef = useRef<GraphCanvasHandle>(null)
  const [edgeKinds, setEdgeKinds] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_EDGE_KINDS))
  const [colorMode, setColorMode] = useState<ColorMode>('kind')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MemoryDetail | null>(null)
  const [hovered, setHovered] = useState<{ label: string; kind: string; degree: number } | null>(
    null,
  )
  const [rebuilding, setRebuilding] = useState(false)
  const [minDegree, setMinDegree] = useState(0)
  const [spotlight, setSpotlight] = useState<ReadonlySet<string> | null>(null)
  /** 以某个节点为中心重取图。搜索命中视图外节点时用 */
  const [focusId, setFocusId] = useState<string | null>(null)

  const { snapshot, filtered, loading, reload } = useGraphData({ revision, focusId, minDegree })

  /**
   * 度数过滤。
   *
   * 真实知识库里总有一批还没长出关联的孤立节点，它们在画面边缘铺成一圈噪点。
   * 允许用户把它们收起来，只看已经成形的结构。
   */
  const select = useCallback(
    async (id: string | null) => {
      setSelectedId(id)
      if (!id) {
        setDetail(null)
        return
      }
      try {
        setDetail(await window.mycelia.getMemory(id))
      } catch (error) {
        app.fail(error)
      }
    },
    [app],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedId) {
        void select(null)
        canvasRef.current?.resetView()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, select])

  /**
   * 搜索：先给出视图内的命中（同步、立刻高亮），再补上全库里视图外的。
   *
   * 只搜视图内的话，大库里搜索基本失效 —— 一万条记忆只渲染一千多个节点，
   * 用户要找的多半就在没渲染的那部分里。
   */
  const searchNodes = useCallback(async (text: string) => {
    const local = canvasRef.current?.search(text) ?? []
    const localIds = new Set(local.map((hit) => hit.id))
    try {
      const remote = await window.mycelia.searchGraphNodes(text, 30)
      return [
        ...local,
        ...remote.filter((hit) => !localIds.has(hit.id)).map((hit) => ({ ...hit, offView: true })),
      ]
    } catch {
      // 全库搜索失败不该让视图内的结果也用不了
      return local
    }
  }, [])

  /**
   * 这两个回调必须是稳定引用。
   *
   * GraphSearch 把它们放进了 effect 依赖里，每次渲染都换一个新函数的话，
   * effect 会不停重跑 —— 搜索请求一轮接一轮地发，结果刚落地就被下一轮清掉，
   * 表现是「输入了却永远显示没有匹配」。
   */
  const clearSpotlight = useCallback(() => setSpotlight(null), [])

  const pickNode = useCallback(
    (id: string) => {
      setSpotlight(null)
      // 不在当前子图里的节点，先以它为中心把图重取一遍再选中
      if (!canvasRef.current?.hasNode(id)) setFocusId(id)
      void select(id)
      canvasRef.current?.focusNode(id)
    },
    [select],
  )

  const toggleEdgeKind = (kind: string) => {
    setEdgeKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  /**
   * 重新排布。
   *
   * 不走 bump 重新取数据那条路 —— 那会让整个渲染器重建，图先消失再整个
   * 蹦出来，中间是一段空白。这里让画布就地重跑力导向：节点从当前位置
   * 逐帧移动到新位置，过程本身就是动画。清库只是为了万一中途退出，
   * 下次进来不会拿到半途的坐标。
   */
  const relayout = async () => {
    try {
      await window.mycelia.resetGraphLayout()
      canvasRef.current?.relayout()
    } catch (error) {
      app.fail(error)
    }
  }

  const rebuild = async () => {
    setRebuilding(true)
    try {
      const result = await window.mycelia.rebuildGraph()
      app.toast(`已重建 ${result.created} 条关联`, 'success')
      reload()
    } catch (error) {
      app.fail(error)
    } finally {
      setRebuilding(false)
    }
  }

  const _clusters = (filtered?.clusters ?? []).filter((cluster) => cluster.size > 1).slice(0, 10)
  const isDark = document.documentElement.dataset.theme === 'dark'
  const isEmpty = !loading && (filtered?.nodes.length ?? 0) === 0

  return (
    <div className="flex h-full min-h-0">
      {/*
        overflow-hidden 是必须的：Sigma 把画布尺寸写成固定像素，详情面板展开时
        这个容器变窄，画布要等 ResizeObserver 回调才跟上，中间那几帧它仍是旧宽度，
        节点标签就溢出来盖在右边的面板上。
      */}
      <div className="relative flex-1 min-w-0 overflow-hidden">
        {/* ── 画布 ── */}
        {filtered && filtered.nodes.length > 0 && (
          <GraphCanvas
            ref={canvasRef}
            snapshot={filtered}
            edgeKinds={edgeKinds}
            colorMode={colorMode}
            selectedId={selectedId}
            onSelect={select}
            onHover={(node) => setHovered(node)}
            themeKey={`${theme}-${isDark}`}
            insetRight={detail ? INSPECTOR_WIDTH : 0}
            spotlight={spotlight}
          />
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-faint">
            <Spinner />
            正在构建图谱
          </div>
        )}

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Empty
              icon={<Icon name="graph" size={28} />}
              title={minDegree > 0 ? '这个连接数下没有节点' : '还没有形成关联'}
              description={
                minDegree > 0
                  ? '把最少连接数调回 0，看看全部节点。'
                  : '记忆之间的关联由语义相似度、共享实体和标签自动生成。攒够几条记忆后结构就会浮现。'
              }
              action={
                minDegree > 0 ? (
                  <Button size="sm" onClick={() => setMinDegree(0)}>
                    显示全部
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}

        <GraphToolbar
          edgeKinds={edgeKinds}
          onToggleEdgeKind={toggleEdgeKind}
          colorMode={colorMode}
          onColorModeChange={setColorMode}
          onRebuild={rebuild}
          rebuilding={rebuilding}
          onRelayout={relayout}
          search={<GraphSearch onSearch={searchNodes} onPick={pickNode} onClear={clearSpotlight} />}
        />

        {/*
          显示条件看的是原始 snapshot，不是过滤后的结果。
          用 filtered 判断会出一个死结：把「最少连接数」拉高到没有节点满足，
          面板自己就消失了 —— 而那个滑块正是唯一能把它调回来的控件，
          用户只能退出重进。控件不该有能力把自己关掉。
        */}
        {snapshot && snapshot.nodes.length > 0 && (
          <GraphStatsPanel
            snapshot={filtered ?? snapshot}
            minDegree={minDegree}
            onMinDegreeChange={setMinDegree}
            colorMode={colorMode}
            onFocusCluster={(cluster) => canvasRef.current?.focusCluster(cluster)}
          />
        )}

        <GraphZoomControls
          onZoom={(direction) => canvasRef.current?.zoom(direction)}
          onReset={() => {
            // 也要清掉聚焦：搜索定位过之后图只剩那个节点的邻域，
            // 只重置相机的话「回到全图」并不会真的回到全图
            setFocusId(null)
            void select(null)
            canvasRef.current?.resetView()
          }}
        />

        {hovered && !selectedId && <GraphHoverCard node={hovered} />}

        {/*
          面板浮在画布上，而不是作为 flex 兄弟把画布挤窄。
          挤窄会改变 Sigma 的视口尺寸，相机比例不变而视口变了，画面里所有
          节点会瞬间平移一大段 —— 就是那个「关掉面板过一会儿节点突然跳一下」。
          浮层让画布尺寸恒定，节点一动不动。
        */}
        <MemoryInspector
          floating
          detail={detail}
          onClose={() => void select(null)}
          onOpenMemory={(id) => {
            void select(id)
            canvasRef.current?.focusNode(id)
          }}
        />
      </div>
    </div>
  )
}
