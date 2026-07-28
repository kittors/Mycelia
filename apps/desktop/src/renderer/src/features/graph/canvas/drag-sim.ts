/**
 * 拖拽时的局部物理仿真。
 *
 * 照搬 d3-force 的能量模型，但只作用于被拖节点周围的一小片邻域。
 * 核心是三行：
 *
 *   alpha += (alphaTarget − alpha) × alphaDecay     能量指数衰减
 *   力 × alpha                                       力随能量减弱
 *   x += (vx ×= velocityDecay)                       速度积分，产生惯性
 *
 * alpha 这个衰减项是整件事的关键。之前试过直接重跑 forceAtlas2 让邻居跟随，
 * 结果是被按住的节点自己乱跑、整张图一路收缩成小球 —— 因为它没有能量概念，
 * 每次迭代都满功率作用于全图，停不下来。有了 alpha：拖拽期间维持一个较低的
 * 目标能量，松手后衰减到零自动静止，位移始终是有界的。
 *
 * 只跑邻域而不是全图，是因为拖一个节点本就不该重排整张图 ——
 * 用户建立起来的空间记忆比「布局最优」重要得多。
 */

import type Graph from 'graphology'
import type Sigma from 'sigma'
import { graphUnit } from './unit.js'

/** 参与仿真的邻域跳数 */
const DEPTH = 2

/** 拖拽期间维持的能量。太高邻居会甩得很远，太低则跟不上手 */
const ALPHA_DRAG = 0.35

/** 每帧向目标能量收敛的比例 */
const ALPHA_DECAY = 0.06

/** 低于这个能量就认为静止了 */
const ALPHA_MIN = 0.005

/** 速度保留比例。越小越「粘」，越大越飘 */
const VELOCITY_DECAY = 0.55

/** 弹簧力强度：把边拉回理想长度的力度 */
const SPRING = 0.35

/** 邻域内的排斥力强度，防止跟随过来的节点叠在一起 */
const REPEL = 1.4

/** 边的理想长度相对两端半径之和的倍数 */
const LINK_SLACK = 4.5

/** 与 decluster.ts 的 padding 保持一致，单位是屏幕像素 */
const DECLUSTER_PADDING = 9

/**
 * 仿真的最长存活帧数。
 *
 * 保险丝，不是正常路径。正常情况下松手会调 release()，能量衰减到阈值就停；
 * 但只要有一条路径漏掉了 release（比如指针在窗口外抬起、事件被别的层吞掉），
 * 仿真就会以满帧率一直跑下去，风扇转个不停。宁可强制掐断。
 */
const MAX_FRAMES = 900

interface Body {
  key: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  /** 离被拖节点几跳。越远受力越弱，形成自然的衰减 */
  hops: number
}

export interface DragSimulation {
  /** 手移动了：更新被拖节点的位置 */
  moveTo(x: number, y: number): void
  /** 松手：能量归零，仿真自己停下来 */
  release(): void
  /** 强制中止，组件卸载时用 */
  stop(): void
}

export function startDragSimulation(
  graph: Graph,
  renderer: Sigma,
  anchor: string,
  onFrame?: () => void,
): DragSimulation {
  // 逐层收集邻域
  const hops = new Map<string, number>([[anchor, 0]])
  const queue = [anchor]
  let head = 0
  while (head < queue.length) {
    const current = queue[head++]
    if (!current) break
    const level = hops.get(current) ?? 0
    if (level >= DEPTH) continue
    for (const neighbor of graph.neighbors(current)) {
      if (hops.has(neighbor)) continue
      hops.set(neighbor, level + 1)
      queue.push(neighbor)
    }
  }

  // 半径与间距是屏幕像素，坐标是图坐标，必须换算，原因见 unit.ts
  const unit = graphUnit(graph)

  const bodies: Body[] = []
  const index = new Map<string, number>()
  for (const [key, level] of hops) {
    index.set(key, bodies.length)
    bodies.push({
      key,
      x: Number(graph.getNodeAttribute(key, 'x')) || 0,
      y: Number(graph.getNodeAttribute(key, 'y')) || 0,
      vx: 0,
      vy: 0,
      r: (Number(graph.getNodeAttribute(key, 'size')) || 3) * unit,
      hops: level,
    })
  }

  // 邻域内部的边，仿真只关心这些
  const links: Array<{ a: number; b: number; rest: number }> = []
  for (const [key] of hops) {
    for (const neighbor of graph.neighbors(key)) {
      const a = index.get(key)
      const b = index.get(neighbor)
      if (a === undefined || b === undefined || a >= b) continue
      const ra = bodies[a]?.r ?? unit * 3
      const rb = bodies[b]?.r ?? unit * 3
      links.push({ a, b, rest: (ra + rb) * LINK_SLACK })
    }
  }

  const fixed = bodies[index.get(anchor) ?? 0] as Body
  let target = { x: fixed.x, y: fixed.y }
  let alpha = ALPHA_DRAG
  let alphaTarget = ALPHA_DRAG
  let raf = 0
  let running = true
  let frames = 0

  const tick = () => {
    if (!running) return
    if (++frames > MAX_FRAMES) {
      running = false
      renderer.refresh({ skipIndexation: false })
      return
    }
    alpha += (alphaTarget - alpha) * ALPHA_DECAY

    // ── 弹簧力：边偏离理想长度就把两端往回拉 ──
    for (const link of links) {
      const a = bodies[link.a] as Body
      const b = bodies[link.b] as Body
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.hypot(dx, dy) || 1e-6
      const force = ((distance - link.rest) / distance) * SPRING * alpha
      const fx = dx * force
      const fy = dy * force
      // 跳数越大受力越弱，扰动自然向外衰减
      a.vx += fx / (a.hops + 1)
      a.vy += fy / (a.hops + 1)
      b.vx -= fx / (b.hops + 1)
      b.vy -= fy / (b.hops + 1)
    }

    // ── 排斥力：跟随过来的节点不能叠在一起 ──
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i] as Body
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j] as Body
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.hypot(dx, dy) || 1e-6
        // 与收尾的 declusterNodes 用同一套间距标准，拖完不会比静止时更挤
        const minimum = a.r + b.r + DECLUSTER_PADDING * unit
        if (distance >= minimum) continue
        const force = ((minimum - distance) / distance) * REPEL * alpha
        a.vx -= dx * force
        a.vy -= dy * force
        b.vx += dx * force
        b.vy += dy * force
      }
    }

    // ── 积分。被拖的节点直接钉在手上，速度归零 ──
    for (const body of bodies) {
      if (body === fixed) {
        body.x = target.x
        body.y = target.y
        body.vx = 0
        body.vy = 0
      } else {
        body.vx *= VELOCITY_DECAY
        body.vy *= VELOCITY_DECAY
        body.x += body.vx
        body.y += body.vy
      }
      graph.setNodeAttribute(body.key, 'x', body.x)
      graph.setNodeAttribute(body.key, 'y', body.y)
    }

    onFrame?.()
    // 拖动中跳过索引重建（O(n log n)，每帧做会卡），静止时补一次
    renderer.refresh({ skipIndexation: true })

    if (alpha < ALPHA_MIN && alphaTarget === 0) {
      running = false
      renderer.refresh({ skipIndexation: false })
      return
    }
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)

  return {
    moveTo(x, y) {
      target = { x, y }
      // 手还在动就把能量补回去，邻居才会持续跟随
      alphaTarget = ALPHA_DRAG
      if (!running) {
        running = true
        frames = 0
        alpha = ALPHA_DRAG
        raf = requestAnimationFrame(tick)
      }
    },
    release() {
      // 能量归零，让它靠惯性滑行几帧再停 —— 这点余韵就是「手感」
      alphaTarget = 0
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
  }
}
