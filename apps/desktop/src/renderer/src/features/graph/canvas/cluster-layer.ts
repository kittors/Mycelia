/**
 * 簇轮廓图层。
 *
 * Sigma 自己管着一摞 canvas，没有给外部插层的接口，所以这里自建一张画布
 * 塞进它的容器、压在最底下（z-index 0），再跟着 Sigma 的 afterRender
 * 事件重绘 —— 相机怎么动，轮廓就怎么跟。
 *
 * 用 2D canvas 而不是 WebGL：轮廓每帧最多几十条路径，2D 完全够用，
 * 而凸包这种不规则形状用着色器画反而绕远。
 *
 * 性能上有两道闸：一是超过一定规模直接不画（见 scale.ts），
 * 二是凸包只在图坐标变了才重算，相机平移缩放时复用上一次的结果。
 */

import type Graph from 'graphology'
import type Sigma from 'sigma'
import { clusterColor } from '../graph-theme.js'
import { convexHull, type HullGroup, paintHulls } from './hull.js'
import type { Prominence } from './prominence.js'

export interface ClusterLayer {
  /** 开关。按类型着色时轮廓没有意义，直接隐藏 */
  setVisible(visible: boolean): void
  /** 图坐标变了（布局在跑、拖了节点），下次重绘要重算凸包 */
  invalidate(): void
  dispose(): void
}

/** 图坐标下的凸包，缓存这个而不是屏幕坐标 —— 相机动了它依然有效 */
interface CachedHull {
  cluster: number
  /** 已经是凸包顶点，屏幕坐标只需对这几个点做变换，而不是全部节点 */
  points: Array<{ x: number; y: number }>
  /** 簇里随便一个节点，用来在每帧问出当前缩放下的节点半径 */
  sample: string
}

/** 轮廓与节点边缘之间的留白（屏幕像素）。节点半径另算 */
const HULL_GAP = 14

export function createClusterLayer(
  renderer: Sigma,
  graph: Graph,
  container: HTMLElement,
  dark: boolean,
  enabled: boolean,
  prominence: Prominence,
): ClusterLayer {
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.zIndex = '0'
  canvas.style.pointerEvents = 'none'
  container.insertBefore(canvas, container.firstChild)

  const ctx = canvas.getContext('2d')
  let visible = false
  let cache: CachedHull[] | null = null

  /**
   * 在**图坐标**上求凸包。
   *
   * 早先是每帧拿所有节点的屏幕坐标现算，相机一动就重来一遍 ——
   * 平移缩放这种最需要流畅的操作反而最费。改成缓存图坐标下的凸包后，
   * 每帧只需把几个顶点投影到屏幕，与节点总数无关。
   */
  const rebuild = (): CachedHull[] => {
    const byCluster = new Map<number, { points: Array<{ x: number; y: number }>; sample: string }>()
    graph.forEachNode((node, attrs) => {
      const cluster = Number(attrs.cluster)
      if (!Number.isFinite(cluster)) return
      /**
       * 只圈主要的簇。
       *
       * 两百多个簇各画一圈的结果是轮廓层层叠叠糊成半透明浆糊 ——
       * 圈的意义是「这一团是一伙的」，圈到处都是就等于没圈。
       */
      if (!prominence.ids.has(cluster)) return
      const display = renderer.getNodeDisplayData(node)
      if (!display) return
      const entry = byCluster.get(cluster)
      if (entry) entry.points.push({ x: display.x, y: display.y })
      else byCluster.set(cluster, { points: [{ x: display.x, y: display.y }], sample: node })
    })

    return [...byCluster.entries()].map(([cluster, entry]) => ({
      cluster,
      // 三点以上先降成凸包，后面每帧只投影这几个点
      points: entry.points.length > 3 ? convexHull(entry.points) : entry.points,
      sample: entry.sample,
    }))
  }

  const draw = () => {
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const { width, height } = container.getBoundingClientRect()
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!visible || !enabled) return

    if (!cache) cache = rebuild()

    const groups: HullGroup[] = cache.map((hull) => ({
      points: hull.points.map((point) => renderer.framedGraphToViewport(point)),
      color: clusterColor(prominence.colorIndex.get(hull.cluster) ?? 0, dark),
      /**
       * 每帧问一次「现在这个缩放下，节点画出来有多大」。
       *
       * 节点半径随相机缩放变化，而轮廓是拿屏幕坐标画的 —— 用固定值的话，
       * 一放大节点就探出圈外。半径要现取，不能缓存。
       */
      padding: HULL_GAP + (renderer.getNodeDisplayData(hull.sample)?.size ?? 0),
    }))

    paintHulls(ctx, groups, dpr)
  }

  renderer.on('afterRender', draw)

  return {
    setVisible(next) {
      visible = next
      draw()
    },
    invalidate() {
      cache = null
    },
    dispose() {
      renderer.off('afterRender', draw)
      canvas.remove()
    },
  }
}
