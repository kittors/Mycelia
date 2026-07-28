/**
 * 相机控制。
 *
 * 坐标必须取自 getNodeDisplayData 而不是图属性：camera 的 x/y 是归一化后的
 * framed 坐标（整图映射到 0~1），直接喂原始图坐标会把镜头甩到画面外。
 *
 * 同理 ratio 是相对整图的缩放（1 = 整图占满视口）。
 *
 * 这里的所有取景都接受一个 inset：详情面板浮在画布右侧，画布本身没有变窄，
 * 但右边那一条是看不见的。不把它算进去，「居中」出来的结果会藏在面板底下。
 */

import type Sigma from 'sigma'

/** 画布四周被浮层遮住的像素数 */
export interface Inset {
  right: number
}

const NO_INSET: Inset = { right: 0 }

/**
 * 视口余量。
 *
 * 只按节点圆心算边界会让最外圈的节点正好贴边 —— 它们的**标签**向外延伸，
 * 于是被视口裁掉。留出这段余量，标签和浮层控件才都有地方待。
 *
 * 但余量要随规模收：节点一多标签本来就不画了（见 scale.ts 的 labelThreshold），
 * 还留着一大圈空白只会让图缩在画面中间一小团。
 */
function paddingFor(nodeCount: number): number {
  if (nodeCount <= 60) return 1.7
  if (nodeCount <= 300) return 1.45
  return 1.12
}

/**
 * 镜头最远只拉到这么近。
 *
 * 图上只有两三个节点时，它们的包围盒很小，按比例算出的 ratio 会把镜头
 * 怼到脸上，几个点各占半屏。稀疏的图本来就该看着稀疏。
 */
const MIN_RATIO = 0.5

/** 判定「已经看得见」时留的边距，太小会让节点贴着边也算数 */
const IN_VIEW_MARGIN = 48

const ANIMATION = { duration: 420, easing: 'quadraticInOut' } as const

/**
 * 把一组节点收进可见区。
 *
 * 有 inset 时不能只缩小 ratio 了事：那样整张图会缩得更小却依然居中，
 * 一半仍压在面板下面。正确做法是同时把镜头往被遮挡的反方向推。
 */
export function fitToNodes(renderer: Sigma, nodes: readonly string[], inset: Inset = NO_INSET) {
  const target = displayBounds(renderer, nodes)
  if (!target) return

  const { width } = renderer.getDimensions()
  const visibleWidth = Math.max(1, width - inset.right)
  // 可见区比画布窄，同样的内容要用更小的比例才装得下
  const shrink = width / visibleWidth

  const span = Math.max(target.maxX - target.minX, target.maxY - target.minY)
  const ratio = Math.min(2, Math.max(MIN_RATIO, span * paddingFor(nodes.length) * shrink))

  const center = {
    x: (target.minX + target.maxX) / 2,
    y: (target.minY + target.maxY) / 2,
  }

  void renderer
    .getCamera()
    .animate({ ...center, ...offsetForInset(renderer, center, inset, ratio), ratio }, ANIMATION)
}

/**
 * 丢弃两端各多少比例的极端坐标。
 *
 * 力导向总会甩出几个离群点 —— 连接特别少的节点被斥力推到很远的地方。
 * 按绝对最值取景的话，这么一两个点就能把包围盒撑大一倍，
 * 主体被压缩到画面一角，剩下大片空白。
 */
const OUTLIER_TRIM = 0.02

function displayBounds(renderer: Sigma, nodes: readonly string[]) {
  const xs: number[] = []
  const ys: number[] = []
  for (const node of nodes) {
    const data = renderer.getNodeDisplayData(node)
    if (!data) continue
    xs.push(data.x)
    ys.push(data.y)
  }
  if (xs.length === 0) return null

  // 节点很少时不裁：那时每一个点都重要，丢掉一个就真的看不到它了
  if (xs.length < 20) {
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  }

  xs.sort((a, b) => a - b)
  ys.sort((a, b) => a - b)
  const lo = Math.floor(xs.length * OUTLIER_TRIM)
  const hi = Math.min(xs.length - 1, Math.ceil(xs.length * (1 - OUTLIER_TRIM)))

  return {
    minX: xs[lo] as number,
    maxX: xs[hi] as number,
    minY: ys[lo] as number,
    maxY: ys[hi] as number,
  }
}

/**
 * 求「把某个图坐标摆到可见区中心」所需的镜头偏移。
 *
 * 靠两次 viewport→framed 反算而不是自己推公式：sigma 的换算里还掺着
 * stagePadding 和设备像素比，手写一遍迟早会和它对不上。
 */
function offsetForInset(
  renderer: Sigma,
  center: { x: number; y: number },
  inset: Inset,
  ratio?: number,
): { x: number; y: number } {
  if (inset.right <= 0) return center

  const { width, height } = renderer.getDimensions()
  const camera = renderer.getCamera()
  const previous = camera.getState()

  // 反算要在目标缩放下进行，否则偏移量会按当前缩放算，缩放一变就偏了
  if (ratio !== undefined && ratio !== previous.ratio) {
    camera.setState({ ...previous, ratio })
  }

  const atCenter = renderer.viewportToFramedGraph({ x: width / 2, y: height / 2 })
  const atVisibleCenter = renderer.viewportToFramedGraph({
    x: (width - inset.right) / 2,
    y: height / 2,
  })

  if (ratio !== undefined && ratio !== previous.ratio) camera.setState(previous)

  return {
    x: center.x + (atCenter.x - atVisibleCenter.x),
    y: center.y + (atCenter.y - atVisibleCenter.y),
  }
}

/**
 * 对准一个节点 —— 但只在它确实看不见的时候动。
 *
 * 每次选中都强行把镜头怼到节点上，是这张图「一点就乱跳」的主要来源：
 * 用户明明看得见那个点，画面却整个平移过去，还顺手把缩放改了，
 * 好不容易建立的空间感一次点击就没了。
 *
 * 所以：已经在可见区里就一动不动；确实被面板挡住或跑出视口了，才平移过去，
 * 而且只平移、不改缩放。
 */
export function focusOnNode(renderer: Sigma, id: string, inset: Inset = NO_INSET): void {
  const data = renderer.getNodeDisplayData(id)
  if (!data) return

  const { width, height } = renderer.getDimensions()
  const position = renderer.framedGraphToViewport(data)
  const visibleRight = width - inset.right

  const inView =
    position.x >= IN_VIEW_MARGIN &&
    position.x <= visibleRight - IN_VIEW_MARGIN &&
    position.y >= IN_VIEW_MARGIN &&
    position.y <= height - IN_VIEW_MARGIN
  if (inView) return

  void renderer.getCamera().animate(offsetForInset(renderer, data, inset), ANIMATION)
}

/** 步进缩放。direction 为 1 放大、-1 缩小 */
export function zoomBy(renderer: Sigma, direction: 1 | -1): void {
  const camera = renderer.getCamera()
  const ratio = camera.getState().ratio * (direction === 1 ? 0.72 : 1.38)
  void camera.animate({ ratio: Math.min(6, Math.max(0.06, ratio)) }, { duration: 200 })
}
