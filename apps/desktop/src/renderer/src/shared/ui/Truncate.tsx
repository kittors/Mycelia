import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Tooltip } from './Tooltip.js'

/**
 * 会省略的文本。
 *
 * 两件事必须一起做，缺一个都不成立：
 *
 *   1. **能收缩**。`truncate` 只在元素宽度受限时才起作用，而 flex/grid 子项默认
 *      `min-width: auto`，宽度被内容顶开，省略号永远不出现 —— 反而把整个布局撑破。
 *      所以这里强制 `min-w-0`。
 *
 *   2. **省略了要能看全**。只在**真的**被截断时才挂 tooltip：
 *      没截断还弹一个内容完全一样的气泡，纯属打扰。
 *
 * 用 ResizeObserver 而不是一次性测量：窗口缩放、侧栏折叠都会改变可用宽度，
 * 截断状态得跟着变。
 */
export function Truncate({
  children,
  className,
  /** 多行省略。1 表示单行 */
  lines = 1,
  /** tooltip 里显示的完整内容，默认用 children 的纯文本 */
  title,
  as: Tag = 'span',
}: {
  children: string
  className?: string
  lines?: number
  title?: string
  as?: 'span' | 'div' | 'p'
}) {
  const ref = useRef<HTMLElement>(null)
  const [clipped, setClipped] = useState(false)

  // children 不出现在 effect 体内，但内容换了就得重新量一遍是否溢出
  // biome-ignore lint/correctness/useExhaustiveDependencies: children 变化正是重新测量的理由
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      // 单行看横向溢出，多行看纵向 —— line-clamp 是靠高度截断的
      const overflowing =
        lines === 1
          ? element.scrollWidth > element.clientWidth + 1
          : element.scrollHeight > element.clientHeight + 1
      setClipped(overflowing)
    }

    measure()

    /**
     * 字体加载完必须重测一次。
     *
     * ResizeObserver 只在**元素自身尺寸**变化时触发，而这里元素宽度由 flex/grid
     * 决定、始终不变；变的是 scrollWidth（内容宽度）。首屏用后备字体测出来「没溢出」，
     * 等真正的字体到位文字变宽，观察器却一声不响 —— 于是省略号出现了，tooltip 却没有。
     */
    document.fonts?.ready.then(measure).catch(() => undefined)

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
    // children 变了内容宽度就变了，必须重测
  }, [lines, children])

  const text = (
    <Tag
      ref={ref as never}
      // 便于排查「该省略却没省略 / 该有 tooltip 却没有」
      data-clipped={clipped || undefined}
      className={cn(
        'min-w-0',
        lines === 1 ? 'truncate' : 'overflow-hidden',
        lines > 1 && `line-clamp-${lines}`,
        className,
      )}
    >
      {children}
    </Tag>
  )

  if (!clipped) return text
  return <Tooltip content={title ?? children}>{text}</Tooltip>
}
