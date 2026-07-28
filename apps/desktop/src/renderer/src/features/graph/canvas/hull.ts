/**
 * 簇的包围轮廓。
 *
 * 只靠节点同色来表示「这几个是一伙的」是不够的：颜色一多就分不清，
 * 而且相邻的两个簇如果色相接近，看上去就是一团。画一圈实际的轮廓，
 * 「哪些点属于同一簇」才成为画面上一眼可见的事实。
 *
 * 轮廓画在 Sigma 各图层之下，属于背景，不能盖住节点和标签。
 */

type Point = { x: number; y: number }

/** 轮廓离最外圈节点的距离 */
const PADDING = 26
/** 角上的圆角半径。太小会显得像多边形围栏，太大则丢掉簇的形状 */
const CORNER = 18

/**
 * 凸包（Andrew's monotone chain）。
 *
 * 用凸包而不是把点圈进一个大圆：圆会把大量空白也圈进来，
 * 两个相邻簇的圆很容易互相重叠，反而看不出边界。
 */
export function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points]

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const build = (source: readonly Point[]) => {
    const chain: Point[] = []
    for (const point of source) {
      while (chain.length >= 2) {
        const last = chain[chain.length - 1] as Point
        const prev = chain[chain.length - 2] as Point
        if (cross(prev, last, point) > 0) break
        chain.pop()
      }
      chain.push(point)
    }
    chain.pop()
    return chain
  }

  return [...build(sorted), ...build([...sorted].reverse())]
}

/** 把多边形沿各顶点的外法线方向撑开，留出节点半径与呼吸空间 */
function inflate(hull: readonly Point[], amount: number): Point[] {
  if (hull.length === 0) return []

  const cx = hull.reduce((sum, p) => sum + p.x, 0) / hull.length
  const cy = hull.reduce((sum, p) => sum + p.y, 0) / hull.length

  return hull.map((point) => {
    const dx = point.x - cx
    const dy = point.y - cy
    const length = Math.hypot(dx, dy) || 1
    return { x: point.x + (dx / length) * amount, y: point.y + (dy / length) * amount }
  })
}

/** 画一条各角都倒圆的闭合折线 */
function traceRounded(ctx: CanvasRenderingContext2D, points: readonly Point[], radius: number) {
  const n = points.length
  ctx.beginPath()

  for (let i = 0; i < n; i++) {
    const current = points[i] as Point
    const next = points[(i + 1) % n] as Point
    const afterNext = points[(i + 2) % n] as Point

    // 圆角半径不能超过相邻边长的一半，否则相邻圆弧会互相穿插
    const edge = Math.hypot(next.x - current.x, next.y - current.y)
    const nextEdge = Math.hypot(afterNext.x - next.x, afterNext.y - next.y)
    const r = Math.min(radius, edge / 2, nextEdge / 2)

    const t1 = edge === 0 ? 0 : r / edge
    const enter = { x: next.x - (next.x - current.x) * t1, y: next.y - (next.y - current.y) * t1 }

    if (i === 0) ctx.moveTo(enter.x, enter.y)
    else ctx.lineTo(enter.x, enter.y)

    const t2 = nextEdge === 0 ? 0 : r / nextEdge
    const exit = {
      x: next.x + (afterNext.x - next.x) * t2,
      y: next.y + (afterNext.y - next.y) * t2,
    }
    ctx.quadraticCurveTo(next.x, next.y, exit.x, exit.y)
  }

  ctx.closePath()
}

export interface HullGroup {
  points: Point[]
  color: string
  label?: string
}

/**
 * 把各簇的轮廓画到画布上。
 *
 * 单点和双点簇也要画 —— 只画三点以上的话，小簇会显得「不算数」，
 * 而稀疏的知识库里恰恰全是小簇。它们退化成圆角胶囊。
 */
export function paintHulls(
  ctx: CanvasRenderingContext2D,
  groups: readonly HullGroup[],
  dpr: number,
): void {
  ctx.save()
  ctx.scale(dpr, dpr)

  for (const group of groups) {
    if (group.points.length === 0) continue

    ctx.fillStyle = group.color
    ctx.strokeStyle = group.color
    ctx.lineWidth = 1.25
    ctx.globalAlpha = 0.07

    if (group.points.length === 1) {
      const only = group.points[0] as Point
      ctx.beginPath()
      ctx.arc(only.x, only.y, PADDING, 0, Math.PI * 2)
    } else if (group.points.length === 2) {
      // 两点连成胶囊：把线段两端各画一个半圆
      const [a, b] = group.points as [Point, Point]
      const angle = Math.atan2(b.y - a.y, b.x - a.x)
      ctx.beginPath()
      ctx.arc(a.x, a.y, PADDING, angle + Math.PI / 2, angle - Math.PI / 2)
      ctx.arc(b.x, b.y, PADDING, angle - Math.PI / 2, angle + Math.PI / 2)
      ctx.closePath()
    } else {
      traceRounded(ctx, inflate(convexHull(group.points), PADDING), CORNER)
    }

    ctx.fill()
    ctx.globalAlpha = 0.32
    ctx.stroke()
  }

  ctx.restore()
}
