/**
 * 图谱的鼠标交互：悬停、点击、拖拽。
 *
 * 拖拽与点击的区分是这里最容易出错的地方 —— 拖完松手浏览器还会派发一次
 * click，不加区分就会「拖动节点后意外选中了它」。所以拖动位移超过阈值时
 * 打标记，让紧随其后的那次点击失效。
 */

import type Graph from 'graphology'
import type Sigma from 'sigma'
import { type DragSimulation, startDragSimulation } from './drag-sim.js'

export interface HoveredNode {
  id: string
  label: string
  kind: string
  degree: number
}

export interface InteractionCallbacks {
  onSelect(id: string | null): void
  onHover(node: HoveredNode | null): void
  /** 悬停变化时刷新高亮（有选中态时悬停不生效，由调用方判断） */
  refresh(): void
  /** 读取当前是否有选中节点 —— 决定悬停要不要触发重绘 */
  hasSelection(): boolean
  setHovered(id: string | null): void
  /** 节点被拖动后图坐标变了，跟随层（簇轮廓）需要重算 */
  onGeometryChange?(): void
  /** 拖拽结束：把新位置存下来，否则下次进图谱又弹回原处 */
  onLayoutChanged?(): void
  /** 拖拽开始/结束。律动要在拖拽期间让位，两股力同时改坐标会打架 */
  onDragStart?(): void
}

export interface InteractionHandle {
  dispose(): void
}

export function bindInteractions(
  renderer: Sigma,
  graph: Graph,
  container: HTMLElement | null,
  cb: InteractionCallbacks,
): InteractionHandle {
  let dragging: string | null = null
  let dragMoved = false
  let simulation: DragSimulation | null = null

  renderer.on('enterNode', ({ node }) => {
    if (dragging) return
    cb.setHovered(node)
    container?.style.setProperty('cursor', 'pointer')
    cb.onHover({
      id: node,
      label: String(graph.getNodeAttribute(node, 'label')),
      kind: String(graph.getNodeAttribute(node, 'kind')),
      degree: Number(graph.getNodeAttribute(node, 'degree')),
    })
    if (!cb.hasSelection()) cb.refresh()
  })

  renderer.on('leaveNode', () => {
    cb.setHovered(null)
    container?.style.setProperty('cursor', 'default')
    cb.onHover(null)
    if (!cb.hasSelection()) cb.refresh()
  })

  renderer.on('clickNode', ({ node }) => {
    if (dragMoved) return
    // 实体节点没有详情页，点它等于取消选中
    cb.onSelect(graph.getNodeAttribute(node, 'nodeType') === 'memory' ? node : null)
  })

  // 点空白处取消选中 —— 用户的直觉出口
  renderer.on('clickStage', () => {
    if (!dragMoved) cb.onSelect(null)
  })

  renderer.on('downNode', ({ node, event }) => {
    dragging = node
    dragMoved = false
    // 按下就起仿真，但此刻还没移动，它只会空转几帧然后自己静下来
    cb.onDragStart?.()
    simulation = startDragSimulation(graph, renderer, node, cb.onGeometryChange)
    renderer.getCamera().disable()
    event.preventSigmaDefault()
    event.original.preventDefault()
  })

  const mouse = renderer.getMouseCaptor()

  const onMove = (event: Parameters<Parameters<typeof mouse.on>[1]>[0]) => {
    if (!dragging) return
    const position = renderer.viewportToGraph(event as never)
    dragMoved = true
    // 位置只告诉仿真，由它每帧把节点钉到手上并驱动邻居 ——
    // 直接改坐标的话邻居不会动，连线就被拉成橡皮筋
    simulation?.moveTo(position.x, position.y)
    ;(event as { preventSigmaDefault(): void }).preventSigmaDefault()
    ;(event as { original: Event }).original.preventDefault()
  }

  const onUp = () => {
    if (!dragging) return
    dragging = null
    renderer.getCamera().enable()
    // 松手不是急停：能量归零后还会靠惯性滑行几帧，这点余韵就是手感
    simulation?.release()
    simulation = null
    if (dragMoved) cb.onLayoutChanged?.()
    // 让这次拖拽尾随的 click 失效；下一次真正的点击会重置它
    setTimeout(() => {
      dragMoved = false
    }, 0)
  }

  mouse.on('mousemovebody', onMove)
  mouse.on('mouseup', onUp)

  return {
    dispose() {
      simulation?.stop()
      mouse.removeListener('mousemovebody', onMove)
      mouse.removeListener('mouseup', onUp)
    },
  }
}
