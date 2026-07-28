/**
 * 静息律动。
 *
 * 布局停下来之后，图是一张完全静止的图片 —— 准确，但没有生气，
 * 看不出这些点之间还存在着张力。让每个节点在自己位置附近极轻微地浮动，
 * 画面就"活"了：知识不是标本，是一直在互相牵动的东西。
 *
 * 三个约束决定了实现方式：
 *
 *   1. **振幅必须极小**。大到能看清单个节点在移动就过了 ——
 *      那会变成干扰，看久了眼睛发晕。目标是余光里察觉到"它在呼吸"，
 *      盯着看却几乎分辨不出位移。
 *   2. **不能污染存下的坐标**。浮动是纯视觉的，基准位置另存一份，
 *      持久化和拖拽都以基准为准，否则每次进出图谱位置都会漂移一点。
 *   3. **不能一直满帧跑**。1200 个节点每秒 60 次更新坐标加重绘，
 *      风扇会转起来。降到 30fps 肉眼看不出差别，功耗减半。
 */

import type Graph from 'graphology'
import type Sigma from 'sigma'

/** 浮动半径相对节点自身半径的比例 */
const AMPLITUDE = 0.55

/** 一个完整周期的毫秒数。慢一点更像呼吸，快了像抖动 */
const PERIOD = 5200

/** 目标帧间隔。30fps 足够顺滑，功耗只有满帧的一半 */
const FRAME_MS = 33

interface Anchor {
  key: string
  /** 基准位置。浮动围绕它进行，持久化也以它为准 */
  x: number
  y: number
  /** 各自不同的相位与方向，避免整张图整齐划一地晃 */
  phase: number
  driftX: number
  driftY: number
  radius: number
}

export interface IdleMotion {
  stop(): void
  /** 拖拽等操作改了坐标，重新采一次基准，否则节点会被拉回旧位置 */
  resync(): void
}

export function startIdleMotion(graph: Graph, renderer: Sigma, unit: number): IdleMotion {
  let anchors: Anchor[] = []
  let raf = 0
  let stopped = false
  let last = 0

  const sample = () => {
    anchors = []
    let index = 0
    graph.forEachNode((key, attrs) => {
      /**
       * 相位由下标推导，不用随机数。
       *
       * 随机会让每次进入图谱的浮动模式都不同 —— 虽然细微，但正是这种
       * "说不上哪里不一样"的差异会让人觉得画面不稳。确定性的相位
       * 保证同一张图每次看起来都一样。
       */
      const phase = (index * 2.399963) % (Math.PI * 2)
      anchors.push({
        key,
        x: Number(attrs.x) || 0,
        y: Number(attrs.y) || 0,
        phase,
        driftX: Math.cos(phase * 1.7),
        driftY: Math.sin(phase * 2.3),
        radius: (Number(attrs.size) || 3) * unit * AMPLITUDE,
      })
      index++
    })
  }

  sample()

  const tick = (now: number) => {
    if (stopped) return
    if (now - last < FRAME_MS) {
      raf = requestAnimationFrame(tick)
      return
    }
    last = now

    const t = (now / PERIOD) * Math.PI * 2
    for (const anchor of anchors) {
      const wave = Math.sin(t + anchor.phase)
      graph.setNodeAttribute(anchor.key, 'x', anchor.x + anchor.driftX * anchor.radius * wave)
      graph.setNodeAttribute(anchor.key, 'y', anchor.y + anchor.driftY * anchor.radius * wave)
    }
    // 浮动不改变拓扑，空间索引不必重建 —— 位移远小于节点半径，命中检测不受影响
    renderer.refresh({ skipIndexation: true })
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      // 停下来时回到基准位置，免得把某一帧的偏移当成真实坐标存下去
      for (const anchor of anchors) {
        graph.setNodeAttribute(anchor.key, 'x', anchor.x)
        graph.setNodeAttribute(anchor.key, 'y', anchor.y)
      }
      renderer.refresh({ skipIndexation: false })
    },
    resync: sample,
  }
}
