/**
 * 力导向布局。
 *
 * 只负责「从随机初始位置排出结构」这一件事，跑完即停。拖拽时的邻居跟随
 * 不走这里 —— 原因见下面 form 的注释。
 *
 * 一次性算完再显示会白屏几秒，而且看不出结构是怎么形成的。这里每帧只跑
 * 几次迭代就重绘，用户能看着簇一点点聚拢 —— 既是观感，也是反馈：
 * 图还在动就说明它还在整理。
 */

import type Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type Sigma from 'sigma'
import { fitToNodes, type Inset } from './camera.js'
import { declusterNodes } from './decluster.js'
import { reelInOutliers } from './reel-in.js'
import type { ScaleProfile } from './scale.js'

export interface LayoutHandle {
  /** 停止布局。组件卸载时必须调用，否则 RAF 会继续访问已销毁的渲染器 */
  stop(): void
  /** 是否还在跑。跟随层（簇轮廓）据此决定要不要每帧重算 */
  running(): boolean
}

export interface LayoutOptions {
  /** 所有节点都有存好的坐标，整个力导向可以跳过 */
  skip?: boolean
  /** 只有少量新节点要落位，跑个短的就够，不必重排全图 */
  partial?: boolean
  /** 坐标定下来之后回调，用于持久化以及启动静息律动 */
  onSettled?: () => void
}

export function runLayout(
  graph: Graph,
  renderer: Sigma,
  profile: ScaleProfile,
  inset: () => Inset,
  options: LayoutOptions = {},
): LayoutHandle {
  if (graph.order <= 1) return { stop: () => undefined, running: () => false }

  /**
   * 坐标齐全就直接开画。
   *
   * 图谱最恼人的一点是每次切进来都要等它重排，而数据根本没变。
   * 更糟的是每次排出来的位置还不一样，上次记住的方位下次就不作数了。
   */
  if (options.skip) {
    renderer.refresh({ skipIndexation: false })
    fitToNodes(renderer, graph.nodes(), inset())
    // 复用坐标这条路径也要回调：律动要在这里接手，否则复用时图是死的
    options.onSettled?.()
    return { stop: () => undefined, running: () => false }
  }

  // 只是给少数新节点找位置，不需要跑满
  const totalFrames = options.partial
    ? Math.max(20, Math.round(profile.layoutFrames * 0.3))
    : profile.layoutFrames

  /**
   * 布局分两个阶段，这是 ForceAtlas2 论文针对「毛球」给出的处方。
   *
   * 密集图上纯力导向必然收敛成一团乱麻 —— 学名就叫 hairball：真实世界的
   * 图大多是小世界结构，局部稠密、有内在社区，而线性引力模型压不出
   * 社区之间的界限。试过用社区检测的结果外加一道向质心的引力，效果是反的：
   * 它在对抗力导向，把图压成几个疙瘩，圈里的点彼此并无关联。
   *
   *   第一阶段（lin-lin）：常规参数把节点粗略铺开，先有个大致骨架。
   *   第二阶段（LinLog）：换 Noack 的对数引力模型 F = log(1 + d)。
   *     引力随距离只按对数增长，相对斥力就弱得多，于是簇内收紧、
   *     簇间推开，社区边界自己浮出来。
   *
   * LinLog 的平衡尺度比 lin-lin 小一个数量级，scalingRatio 必须跟着降 ——
   * 论文自己的对照实验里也是这么做的（他们降到 0.1），否则整张图会缩成一点。
   */
  const base = {
    ...forceAtlas2.inferSettings(graph),
    edgeWeightInfluence: 1,
    slowDown: 3,
    barnesHutOptimize: profile.barnesHut,
    strongGravityMode: false,
    /**
     * 不开 adjustSizes（Gephi 里叫 Prevent Overlap）。
     *
     * 它会接管斥力的计算方式，与 barnesHut 近似斥力冲突 —— Gephi 的文档
     * 明确说这两个不该一起用，而且它只该在图已经排布好之后再开。
     * 一起开的实际后果是它压掉了 LinLog 的社区分离效果：实测一份
     * 99% 边都在簇内的图，怎么调重力和斥力都收敛成均匀圆盘。
     *
     * 节点重叠改由收尾的 declusterNodes 处理，那是确定性的几何分离，
     * 不掺进力学模型里。
     */
    adjustSizes: false,
  }

  const spread = { ...base, gravity: 1, scalingRatio: 12, linLogMode: false }

  const sharpen = {
    ...base,
    linLogMode: true,
    /**
     * 把枢纽推向外围。
     *
     * 每条边的引力除以源节点的度数，连接极多的节点因此受到的总拉力反而小，
     * 不会把所有簇都吸到自己身上糊成一坨 —— Gephi 里叫 hub dissuasion。
     */
    outboundAttractionDistribution: true,
    /**
     * 重力几乎关掉。
     *
     * 这是让簇真正分开的关键。重力把所有节点往原点拉，社区之间的斥力
     * 再大也会被它抵消 —— 实测一份 99% 的边都在簇内的图（社区结构极强），
     * gravity 0.6 时仍然收敛成一个均匀圆盘，看不出任何分组。
     * 论文自己的 LinLog 对照实验里 Gravity 直接取 0。
     *
     * 但也不能真取 0：簇之间几乎不相连时，斥力会把它们推到无穷远，
     * 取景要么框不住要么缩到看不清。
     *
     * 重力和斥力这一对要一起调，它们分别管两件事：
     *   gravity     —— 簇与簇之间离多远。调大，各簇往中心收拢
     *   scalingRatio —— 簇内部有多松。调大，同簇的点彼此散开
     * LinLog 的引力本就把簇内压得很紧（论文原话是 makes clusters more tight），
     * 所以斥力要给足，否则每个簇都是一颗密不透风的疙瘩。
     *
     * 但斥力也不能一味调大：它同时把簇推得更远，画面会变成几团孤岛
     * 散在大片空白里。簇内的间距交给收尾的 declusterNodes 保证 ——
     * 那是确定性的，处处一致；力学只负责把结构排出来。
     */
    gravity: 1.6,
    scalingRatio: 2.5,
  }

  /**
   * 前多少比例的帧用来粗略铺开，之后切到 LinLog 锐化社区。
   *
   * 铺开阶段短一些：它只需要把节点从初始螺旋摊开成大致的形状，
   * 真正排出社区结构的是 LinLog —— 而对数引力收敛得慢，
   * 迭代不够的话簇刚要分开就停了，看上去还是一个圆盘。
   */
  const SPREAD_RATIO = 0.25
  const spreadFrames = Math.floor(totalFrames * SPREAD_RATIO)

  let frame = 0
  let raf = 0
  let stopped = false
  let formed = false

  /**
   * 成形阶段：从随机初始位置跑到结构显现。
   *
   * 跑完就彻底停下，不再保留一个「随时可唤醒」的仿真。试过在拖拽时
   * 重新调用 forceAtlas2 让邻居跟随，结果是灾难性的：它没有 alpha 衰减，
   * 每次 assign 都满功率算全图，于是被拖的节点自己在动、远处不相干的
   * 节点在动、整体尺度一路收缩，最后整张图缩成一个小球。
   * 拖拽的跟随改由 relax.ts 做局部处理。
   */
  const form = () => {
    if (stopped) return
    forceAtlas2.assign(graph, {
      iterations: profile.iterationsPerFrame,
      settings: frame < spreadFrames ? spread : sharpen,
    })

    /**
     * 布局期间只重绘、不重建空间索引。
     *
     * 每帧 `skipIndexation: false` 是这张图在大数据量下最大的性能陷阱：
     * 索引重建是 O(n log n) 且无法分摊，几万个节点单帧就要几十毫秒，
     * 帧率直接掉到个位数。而索引只服务于鼠标命中检测 —— 布局还在动的时候
     * 用户本来也点不准，等它停下来再重建一次就够了。
     */
    if (frame % profile.redrawEvery === 0) renderer.refresh({ skipIndexation: true })

    if (++frame < totalFrames) {
      raf = requestAnimationFrame(form)
      return
    }

    /**
     * 收尾两步，顺序不能换：
     *
     *   1. 防重叠 —— 力导向的 adjustSizes 只能缓解不能消除
     *      （连续的力在密集区达不到完全分离），这里补一遍确定性的几何分离。
     *   2. 重建索引 —— 上一步在改坐标，索引必须建在最终坐标上，
     *      否则鼠标点击会打偏。
     */
    /**
     * 先把飞远的收回来，再做防重叠。
     *
     * 顺序要紧：归置会改坐标，放在防重叠之后就可能把刚分开的点又推重叠了。
     */
    reelInOutliers(graph)
    declusterNodes(graph, { iterations: profile.declusterPasses })
    renderer.refresh({ skipIndexation: false })
    formed = true
    options.onSettled?.()
    // 用 fit 而不是 animatedReset：后者把整图缩到正好铺满视口，
    // 最外圈节点的标签就悬在画面外
    fitToNodes(renderer, graph.nodes(), inset())
  }

  raf = requestAnimationFrame(form)

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
    },
    running: () => !formed && !stopped,
  }
}
