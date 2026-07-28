import {
  Children,
  type CSSProperties,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from '../hooks/usePresence.js'
import { cn } from '../lib/cn.js'

/** 把多个 ref 合并成一个回调 ref —— 子元素通常已经有自己的 ref */
function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value)
      else if (ref && typeof ref === 'object') (ref as { current: T | null }).current = value
    }
  }
}

type Side = 'top' | 'bottom'

interface Placement {
  x: number
  y: number
  side: Side
  maxHeight: number
}

/** 悬停多久才弹。太快会在鼠标划过时乱闪，太慢又像没反应 */
const OPEN_DELAY = 420
const EXIT_DURATION = 130
const GAP = 6
const VIEWPORT_MARGIN = 8
const MAX_WIDTH = 320

/**
 * 提示气泡。
 *
 * 自己实现而不是引 floating-ui：这里只需要「贴在触发元素上下、别超出视口」，
 * 用不上它那套完整的碰撞检测与中间件体系。但定位手法借用了它的核心思路，
 * 原因见下面 measure 的注释。
 *
 * 渲染进 portal —— 挂在原地会被祖先的 `overflow: hidden` 裁掉，
 * 而需要 tooltip 的地方（截断的文本、密集的图表格子）恰恰都在这种容器里。
 */
export function Tooltip({
  content,
  children,
  disabled,
  side = 'top',
}: {
  content: ReactNode
  /** 必须是单个能接收 ref 与鼠标事件的元素 —— 事件直接挂在它身上 */
  children: ReactElement
  disabled?: boolean
  side?: Side
}) {
  const id = useId()
  const anchorRef = useRef<HTMLElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const { mounted, exiting } = usePresence(open, EXIT_DURATION)

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setOpen(false)
  }, [])

  const show = useCallback(() => {
    if (disabled || !content) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPlacement(null) // 清掉上一次的结果，强制重新测量
      setOpen(true)
    }, OPEN_DELAY)
  }, [content, disabled])

  // 卸载时清掉定时器，否则组件没了还会尝试 setState
  useEffect(() => () => hide(), [hide])

  // 滚动或改窗口大小时直接收起：跟着重算位置不值得，用户此刻也不在看它
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  /**
   * 测量并摆位。
   *
   * 气泡在 CSS 里恒定停在视口左上角（left:0 top:0），靠 transform 移动到目标位置。
   * 这不是绕远路，而是唯一能测准的做法：`fixed` 元素的可用宽度是
   * 「视口宽 - left」，如果先把 left 设成锚点位置（比如靠右边缘的格子），
   * 元素只剩几十像素可用，文字立刻折成一长条，量到的宽高全是错的 ——
   * 再拿这个错误高度去算 top，气泡就会飞到离锚点很远的地方。
   *
   * 停在原点测量则不受任何边界压缩，max-width 能完整生效，量到的就是真实尺寸。
   */
  useLayoutEffect(() => {
    if (!mounted || placement) return
    const bubble = bubbleRef.current
    const anchor = anchorRef.current
    if (!bubble || !anchor) return

    // 用 offsetWidth/Height 而不是 getBoundingClientRect：入场动画从挂载那一刻
    // 就开始播，此刻元素正处在 scale(0.94)，rect 量到的是缩小 6% 后的尺寸，
    // 据此算出的边距会比设定值少几像素（气泡最后贴到视口边上）。
    // offset 系列返回布局尺寸，不受 transform 影响。
    const box = { width: bubble.offsetWidth, height: bubble.offsetHeight }
    const rect = anchor.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    // 水平：以锚点中心对齐，再夹进视口
    const x = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left + rect.width / 2 - box.width / 2, viewportW - box.width - VIEWPORT_MARGIN),
    )

    // 垂直：首选方向放不下就翻面；两边都放不下时选空间大的一侧并限高
    const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN
    const spaceBelow = viewportH - rect.bottom - GAP - VIEWPORT_MARGIN
    const preferred = side
    const fits = preferred === 'top' ? spaceAbove >= box.height : spaceBelow >= box.height
    const flipped: Side = preferred === 'top' ? 'bottom' : 'top'
    const fitsFlipped = flipped === 'top' ? spaceAbove >= box.height : spaceBelow >= box.height

    let resolved: Side = preferred
    if (!fits) resolved = fitsFlipped ? flipped : spaceAbove > spaceBelow ? 'top' : 'bottom'

    const room = resolved === 'top' ? spaceAbove : spaceBelow
    const height = Math.min(box.height, room)
    const y = resolved === 'top' ? rect.top - height - GAP : rect.bottom + GAP

    setPlacement({ x: Math.round(x), y: Math.round(y), side: resolved, maxHeight: room })
  }, [mounted, placement, side])

  /**
   * 事件直接挂到子元素，不外包一层。
   *
   * 早先用 `<span className="contents">` 包裹，想着 display:contents 不生成盒子
   * 就不会破坏外面的 flex/grid —— 但正因为它不生成盒子，**也收不到鼠标事件**，
   * tooltip 永远弹不出来。包一个普通 span 又会破坏 truncate 所需的宽度约束。
   * 所以只能把 ref 和事件注入子元素本身。
   */
  const child = Children.only(children)
  const anchored = isValidElement<Record<string, unknown>>(child)
    ? cloneElement(child, {
        ref: mergeRefs(anchorRef, (child as { ref?: Ref<HTMLElement> }).ref),
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
        'aria-describedby': mounted ? id : undefined,
      })
    : child

  return (
    <>
      {anchored}

      {mounted &&
        createPortal(
          <div
            // 定位层：只负责搬运，绝不参与动画 —— transform 一个元素上只能有一份，
            // 位移和缩放挤在一起会互相覆盖
            style={{
              transform: `translate3d(${placement?.x ?? 0}px, ${placement?.y ?? 0}px, 0)`,
              maxWidth: MAX_WIDTH,
              visibility: placement ? 'visible' : 'hidden',
            }}
            className="fixed left-0 top-0 z-[100] pointer-events-none"
          >
            <div
              ref={bubbleRef}
              id={id}
              role="tooltip"
              style={
                {
                  maxHeight: placement?.maxHeight,
                  transformOrigin: placement?.side === 'bottom' ? 'top center' : 'bottom center',
                  // 贴在锚点下方的气泡从上方落下，贴在上方的从下方升起
                  '--pop-offset': placement?.side === 'bottom' ? '-4px' : '4px',
                } as CSSProperties
              }
              className={cn(
                'overflow-hidden px-2 py-1 rounded-[6px]',
                'bg-overlay border border-border shadow-md',
                'text-[11.5px] leading-snug text-text break-words',
                exiting ? 'animate-overlay-out' : 'animate-overlay-in',
              )}
            >
              {content}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
