/**
 * 高亮与淡出。
 *
 * 焦点优先级：选中 > 悬停。有焦点时非邻域的一切都退成灰色背景，
 * 让「这个节点连着谁」成为画面上唯一的信息 ——
 * 这是图谱可读性的关键，没有它就只是一团发光的毛球。
 */

import type Graph from 'graphology'
import type Sigma from 'sigma'
import { clusterColor, type GraphPalette, readKindColor } from '../graph-theme.js'
import { fade } from './color.js'
import type { Prominence } from './prominence.js'

export type ColorMode = 'kind' | 'cluster'

export interface HighlightState {
  /** 当前焦点节点，null 表示无焦点（显示全图） */
  focus: string | null
  /** 焦点的邻居集合，随焦点一起算好传进来避免重复计算 */
  neighbors: Set<string> | null
  edgeKinds: ReadonlySet<string>
  colorMode: ColorMode
  /** 搜索命中的节点。有值时其余节点淡出，但不改变选中态 */
  spotlight?: ReadonlySet<string> | null
  /** 哪些簇值得着色，见 prominence.ts */
  prominence: Prominence
  /** 无焦点时边的底色，已按规模调好浓淡 */
  restingEdgeColor: string
}

export function applyHighlight(
  renderer: Sigma,
  graph: Graph,
  palette: GraphPalette,
  dark: boolean,
  state: HighlightState,
): void {
  const { focus, neighbors, edgeKinds, colorMode, spotlight, prominence, restingEdgeColor } = state

  const colorOf = (attrs: Record<string, unknown>): string => {
    if (attrs.nodeType === 'entity') return palette.neutral
    if (colorMode !== 'cluster') return readKindColor(String(attrs.kind))

    /**
     * 只给主要的簇上色。
     *
     * 两百多个簇各给一种颜色的结果是十种色相循环二十轮，相邻的簇撞色，
     * 「同色 = 同簇」这个约定就失效了 —— 画面成了随机彩点。
     * 零散的小簇退到中性灰，几个大簇才认得出来。
     */
    const cluster = Number(attrs.cluster)
    const index = prominence.colorIndex.get(cluster)
    return index === undefined ? palette.dimmed : clusterColor(index, dark)
  }

  renderer.setSetting('nodeReducer', (node, data) => {
    const base = { ...data, color: colorOf(data) }

    /**
     * 搜索态优先于焦点态。
     *
     * 搜索的目的就是「在一堆点里找出这几个」，此时哪个节点被选中并不重要 ——
     * 先让命中的浮出来，用户点了某一个之后自然回到焦点态。
     */
    if (spotlight && spotlight.size > 0) {
      if (spotlight.has(node)) {
        return { ...base, size: data.size * 1.5, zIndex: 3, highlighted: true }
      }
      return { ...base, color: palette.dimmed, label: '', zIndex: 0 }
    }

    if (!focus) {
      // 待确认的记忆冲淡表示「还没定」。是朝背景混色而不是调透明度 ——
      // 半透明色会被 WebGL 的预乘混合推成纯白，节点直接从画面上消失
      return data.status === 'pending'
        ? { ...base, color: fade(base.color, palette.background, 0.55) }
        : base
    }

    if (node === focus) {
      return { ...base, size: data.size * 1.45, zIndex: 3, forceLabel: true, highlighted: true }
    }
    if (neighbors?.has(node)) {
      /**
       * 邻居不强制显示标签。
       *
       * 一个枢纽有几十个邻居，全都 forceLabel 的话标签会在它周围叠成
       * 一堵墙，连被点中的那个都看不清 —— 而用户此刻想读的恰恰是那一个。
       * 邻居靠高亮和放大表达「相关」，够了。
       */
      return { ...base, zIndex: 2 }
    }
    return { ...base, color: palette.dimmed, label: '', zIndex: 0 }
  })

  renderer.setSetting('edgeReducer', (edge, data) => {
    if (!edgeKinds.has(String(data.kind))) return { ...data, hidden: true }

    const [source, target] = graph.extremities(edge)
    // 无焦点时边只是背景纹理，浓淡由规模决定；有焦点时才把相关的那几条提亮
    if (!focus) return { ...data, color: restingEdgeColor, zIndex: 0 }

    if (source === focus || target === focus) {
      return { ...data, color: palette.edgeActive, size: Math.max(1, data.size * 1.7), zIndex: 2 }
    }
    // 邻域内部的边保留一点可见度，能看出邻居之间也有联系
    if (neighbors?.has(source) && neighbors.has(target)) {
      return { ...data, color: palette.edge, zIndex: 1 }
    }
    return { ...data, hidden: true }
  })

  renderer.refresh({ skipIndexation: true })
}
