/**
 * 防重叠。
 *
 * 力导向只有引力和斥力两种力，没有「体积」的概念 —— 它眼里节点是质点，
 * 半径为零。于是相连的节点被引力拉到一起后就叠在同一个位置上，
 * 画面上一个圆圈底下可能压着五个节点，看上去是「一个点」。
 * 关联越强重叠越严重，恰好把最该看清的结构糊掉了。
 *
 * 这里在布局收尾后做一遍分离。要点是**别做 O(n²) 的两两比较** ——
 * 一千个节点就是五十万次判断，几万个节点直接卡死。改用均匀网格做空间哈希：
 * 只有落在相邻九宫格里的节点才可能碰撞，平均每次检查的候选是个小常数，
 * 整体退化到 O(n·k)。
 */

import type Graph from 'graphology'
import { graphUnit } from './unit.js'

export interface DeclusterOptions {
  /** 迭代轮数。每轮把重叠的推开一点，多轮收敛得更自然 */
  iterations?: number
  /** 圆之间额外留的间隙，单位与节点半径一致 */
  padding?: number
  /** 每轮位移的比例，太大容易来回震荡 */
  strength?: number
}

interface Body {
  key: string
  x: number
  y: number
  r: number
}

/**
 * 把格子的二维编号压成一个整数键。
 *
 * 比字符串拼接快一个量级，而且不产生垃圾对象 —— 这个函数每轮每节点
 * 要调用十次，是整个算法里最热的一处。
 *
 * 偏移 0x8000 是为了容纳负坐标（力导向的坐标以原点为中心，一半是负的）。
 */
function cellKey(gx: number, gy: number): number {
  return (gx + 0x8000) * 0x10000 + (gy + 0x8000)
}

export function declusterNodes(graph: Graph, options: DeclusterOptions = {}): number {
  const iterations = options.iterations ?? 8
  /**
   * 间隙给足。
   *
   * 之前是 1.2，只比「刚好不相交」多一点点 —— 圆是分开了，但挨得太紧，
   * 看上去仍是一团糊。图要看着舒服，点与点之间得有肉眼可辨的空隙，
   * 而且这个空隙应该处处一致：均匀的间距本身就是「规整」的来源。
   */
  const padding = options.padding ?? 9
  const strength = options.strength ?? 0.7

  const bodies: Body[] = []
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  graph.forEachNode((key, attrs) => {
    const x = Number(attrs.x) || 0
    const y = Number(attrs.y) || 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    bodies.push({ key, x, y, r: Number(attrs.size) || 3 })
  })
  if (bodies.length < 2) return 0

  // 半径与间隙是屏幕像素，坐标是图坐标，必须换算，原因见 unit.ts
  const unit = graphUnit(graph)

  const scaled = bodies.map((body) => ({ ...body, r: body.r * unit }))
  bodies.length = 0
  bodies.push(...scaled)

  const paddingScaled = padding * unit
  let maxRadius = 0
  for (const body of bodies) maxRadius = Math.max(maxRadius, body.r)

  const cell = (maxRadius + paddingScaled) * 2
  const buckets = new Map<number, number[]>()
  let moved = 0

  for (let pass = 0; pass < iterations; pass++) {
    buckets.clear()
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i] as Body
      const key = cellKey(Math.floor(body.x / cell), Math.floor(body.y / cell))
      const bucket = buckets.get(key)
      if (bucket) bucket.push(i)
      else buckets.set(key, [i])
    }

    let collisions = 0
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i] as Body
      const gx = Math.floor(a.x / cell)
      const gy = Math.floor(a.y / cell)

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = buckets.get(cellKey(gx + ox, gy + oy))
          if (!bucket) continue

          for (const j of bucket) {
            // 只处理 i < j，同一对不要推两次（推两次等于力翻倍，会震荡）
            if (j <= i) continue
            const b = bodies[j] as Body

            let dx = b.x - a.x
            let dy = b.y - a.y
            let distance = Math.hypot(dx, dy)
            const minimum = a.r + b.r + paddingScaled
            if (distance >= minimum) continue

            /**
             * 完全重合的情况要单独处理。
             *
             * 距离为 0 时没有「推开的方向」可言，除以它还会得到 NaN，
             * 把节点甩到坐标系外面去。用节点下标造一个确定性的角度错开 ——
             * 确定性很重要：同一张图每次布局结果要一致，否则每次打开
             * 图谱的样子都不一样。
             */
            if (distance < 1e-6) {
              const angle = ((i * 2654435761 + j) % 628) / 100
              dx = Math.cos(angle)
              dy = Math.sin(angle)
              distance = minimum * 0.01
            }

            /**
             * 位移比例必须钳位。
             *
             * (minimum − distance) / distance 在两点几乎重合时趋于无穷，
             * 不加限制会把节点一脚踹到坐标系外面，图整个炸开。
             * 上限取 1 表示单次最多推开一个「最小间距」那么远。
             */
            const push = Math.min(1, (minimum - distance) / distance) * strength * 0.5
            const sx = dx * push
            const sy = dy * push
            a.x -= sx
            a.y -= sy
            b.x += sx
            b.y += sy
            collisions++
          }
        }
      }
    }

    moved = collisions
    // 这一轮没有任何重叠就提前收工，稀疏图上通常两三轮就干净了
    if (collisions === 0) break
  }

  for (const body of bodies) {
    graph.setNodeAttribute(body.key, 'x', body.x)
    graph.setNodeAttribute(body.key, 'y', body.y)
  }
  return moved
}
