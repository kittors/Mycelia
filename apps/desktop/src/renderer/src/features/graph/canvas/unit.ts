/**
 * 图坐标与屏幕像素的换算。
 *
 * 这是这套代码里最容易出错的一处，值得单独拎出来说清楚：
 *
 *   - 节点的 `size` 是 **sigma 的屏幕半径**，单位是像素
 *   - 节点的 `x` / `y` 是 **图坐标**，尺度由力导向自己决定，可大可小
 *
 * 两者不是一个量纲。直接拿 size 当图坐标里的半径去比较距离，等于用厘米
 * 和英寸比大小：图整体尺度大时算出来的间距小得可以忽略（防重叠推不动、
 * 拖拽时节点叠成一坨），尺度小时又会把图炸开。
 *
 * 防重叠、拖拽仿真、静息律动三处都要用到这个换算，所以放在这里共用 ——
 * 各自抄一份的下场是改了一处忘了另两处，而这种 bug 从现象上完全看不出
 * 根因（表现是「间距参数怎么调都不对」）。
 */

import type Graph from 'graphology'

/** 假定整张图大致铺满这么宽的画布，用来估算比例 */
const REFERENCE_WIDTH = 900

/** 返回「一个屏幕像素等于多少图坐标单位」 */
export function graphUnit(graph: Graph): number {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  graph.forEachNode((_, attrs) => {
    const x = Number(attrs.x) || 0
    const y = Number(attrs.y) || 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })

  if (!Number.isFinite(minX)) return 1
  return (Math.max(maxX - minX, maxY - minY) || 1) / REFERENCE_WIDTH
}
