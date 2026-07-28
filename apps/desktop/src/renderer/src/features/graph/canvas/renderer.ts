/**
 * Sigma 渲染器的构造。
 *
 * 单独拎出来是因为这堆参数需要成组阅读：labelDensity 与 labelThreshold
 * 一起决定标签露出多少、hideEdgesOnMove 与边的数量挂钩、
 * stagePadding 影响取景计算。散在组件的生命周期代码里，
 * 想调一个就得先在几十行接线逻辑中把它们找齐。
 */

import type Graph from 'graphology'
import Sigma from 'sigma'
import type { GraphPalette } from '../graph-theme.js'
import type { ScaleProfile } from './scale.js'

export function createRenderer(
  graph: Graph,
  container: HTMLElement,
  palette: GraphPalette,
  profile: ScaleProfile,
): Sigma {
  return new Sigma(graph, container, {
    labelFont: getComputedStyle(document.body).fontFamily,
    labelSize: 11,
    labelWeight: '500',
    labelColor: { color: palette.label },
    labelDensity: profile.labelDensity,
    labelGridCellSize: 110,
    labelRenderedSizeThreshold: profile.labelThreshold,
    renderEdgeLabels: false,
    defaultEdgeColor: palette.edge,
    enableEdgeEvents: false,
    hideEdgesOnMove: profile.hideEdgesOnMove,
    zIndex: true,
    stagePadding: 60,
    minCameraRatio: 0.06,
    maxCameraRatio: 6,
  })
}
