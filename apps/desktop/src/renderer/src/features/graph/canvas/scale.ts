/**
 * 按规模分级。
 *
 * 同一套渲染参数没法同时伺候 20 个节点和 20 万个节点：小图要的是精致
 * （每个点都有标签、簇有轮廓、布局跑到收敛），大图要的是「还能动」。
 * 与其在各处零散地写 `if (nodes > 1000)`，不如把规模判断集中成一张表，
 * 各模块只问「这一档该怎么做」。
 *
 * 阈值都是按「一帧 16ms 能做完多少事」估的，宁可提前降级：
 * 卡顿比少几个标签严重得多。
 */

export type GraphScale = 'small' | 'medium' | 'large' | 'huge'

export interface ScaleProfile {
  scale: GraphScale
  /** 力导向总帧数。大图收敛慢，但用户不会盯着它跑完 */
  layoutFrames: number
  iterationsPerFrame: number
  /** 建四叉树。小图上建树开销大于收益，大图上不建就是 O(n²) */
  barnesHut: boolean
  /** 画簇轮廓。每帧要遍历全部节点求凸包，大图上必须关 */
  clusterHulls: boolean
  /** 标签渲染的尺寸门槛，越高露出的标签越少 */
  labelThreshold: number
  labelDensity: number
  /** 拖动期间隐藏边 */
  hideEdgesOnMove: boolean
  /** 布局过程中每隔几帧才重绘一次 —— 大图上每帧重绘光是提交缓冲就吃满了 */
  redrawEvery: number
  /**
   * 节点半径缩放。
   *
   * 点的大小必须跟着规模走：十几个点时画大一些才有存在感，
   * 上千个点还用同样的半径，圆圈就会彼此重叠糊成一张色块地毯 ——
   * 那时候看到的是「有多少颜色」，而不是「有多少节点、怎么连的」。
   */
  nodeSize: number
  /**
   * 防重叠的迭代轮数。
   *
   * 每轮都是 O(n·k)，大图上多跑几轮的代价是线性的；但轮数太多在密集区
   * 会把整团结构撑开变形，反而丢了「这些点聚在一起」的信息。
   */
  declusterPasses: number
  /**
   * 边的不透明度。
   *
   * 边多起来之后，每条都清晰可见的结果是它们互相盖住，
   * 一千条线交织成一张灰网，节点反而沉在网底下。边越多单条越该淡 ——
   * 此时有意义的信息是「哪里稠密」，而不是「这两个点之间有一条线」。
   */
  edgeAlpha: number
  /** 边的线宽系数 */
  edgeWidth: number
  /**
   * 静息律动。
   *
   * 大图上关掉：几万个节点每秒更新几十次坐标，收益（一点点生气）
   * 远不抵功耗，而且那个规模下画面本来就密到看不出单个节点在动。
   */
  idleMotion: boolean
}

export function profileFor(nodeCount: number, edgeCount: number): ScaleProfile {
  if (nodeCount <= 300) {
    return {
      scale: 'small',
      idleMotion: true,
      edgeAlpha: 0.55,
      edgeWidth: 1,
      declusterPasses: 40,
      nodeSize: 1,
      layoutFrames: 120,
      iterationsPerFrame: 5,
      barnesHut: false,
      clusterHulls: true,
      labelThreshold: 6.5,
      labelDensity: 0.22,
      hideEdgesOnMove: false,
      redrawEvery: 1,
    }
  }

  if (nodeCount <= 3000) {
    return {
      scale: 'medium',
      idleMotion: true,
      edgeAlpha: 0.13,
      edgeWidth: 0.6,
      declusterPasses: 32,
      nodeSize: 0.55,
      layoutFrames: 150,
      iterationsPerFrame: 5,
      barnesHut: true,
      clusterHulls: true,
      labelThreshold: 9,
      labelDensity: 0.12,
      hideEdgesOnMove: edgeCount > 4000,
      redrawEvery: 2,
    }
  }

  if (nodeCount <= 30000) {
    return {
      scale: 'large',
      idleMotion: false,
      edgeAlpha: 0.08,
      edgeWidth: 0.4,
      declusterPasses: 16,
      nodeSize: 0.3,
      layoutFrames: 90,
      iterationsPerFrame: 3,
      barnesHut: true,
      // 三万个点求凸包，一帧算不完；此时簇的形状本来也糊成一片了
      clusterHulls: false,
      labelThreshold: 14,
      labelDensity: 0.05,
      hideEdgesOnMove: true,
      redrawEvery: 4,
    }
  }

  return {
    scale: 'huge',
    idleMotion: false,
    edgeAlpha: 0.07,
    edgeWidth: 0.3,
    declusterPasses: 3,
    nodeSize: 0.18,
    layoutFrames: 30,
    iterationsPerFrame: 2,
    barnesHut: true,
    clusterHulls: false,
    // 这个量级只剩「云图」的意义，标签一律不画，靠搜索定位
    labelThreshold: 24,
    labelDensity: 0.02,
    hideEdgesOnMove: true,
    redrawEvery: 6,
  }
}
