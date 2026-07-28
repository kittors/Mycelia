import { useCallback, useEffect, useRef } from 'react'

/**
 * 分栏时两边同步滚动。
 *
 * 不同步的话，左右两栏各滚各的 —— 写到文档中段，左边在讲 A 章节，
 * 右边显示的是 B 章节，分栏预览就失去了意义（它的全部价值就是
 * 「改一处，立刻看到那一处的效果」）。
 *
 * 按滚动比例而不是按行号映射：行号映射要给每个渲染块打上源文行号，
 * 而 marked 的 token 不带行号，得靠累积 raw 长度反推，还要处理
 * 引用式链接跨块的情况。比例同步用四十行换来九成的效果，
 * 剩下那一成的偏差（图片让预览比源文长得多）肉眼几乎看不出来。
 */
export function useSyncScroll(enabled: boolean) {
  const left = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  /**
   * 谁在主动滚。
   *
   * 没有这把锁的话，A 同步 B 会触发 B 的 scroll 事件，B 再回过头同步 A，
   * 两边互相推挤成抖动。锁在下一帧释放 —— 用 setTimeout 会在快速滚动时
   * 攒下一串待释放的定时器，而滚动本来就是每帧一次的事。
   */
  const driver = useRef<'left' | 'right' | null>(null)
  const frame = useRef(0)

  const sync = useCallback((from: HTMLDivElement, to: HTMLDivElement) => {
    const fromRange = from.scrollHeight - from.clientHeight
    const toRange = to.scrollHeight - to.clientHeight
    if (fromRange <= 0 || toRange <= 0) return
    to.scrollTop = (from.scrollTop / fromRange) * toRange
  }, [])

  useEffect(() => {
    const a = left.current
    const b = right.current
    if (!enabled || !a || !b) return

    const handler = (side: 'left' | 'right') => () => {
      if (driver.current && driver.current !== side) return
      driver.current = side
      cancelAnimationFrame(frame.current)
      sync(side === 'left' ? a : b, side === 'left' ? b : a)
      frame.current = requestAnimationFrame(() => {
        driver.current = null
      })
    }

    const onLeft = handler('left')
    const onRight = handler('right')
    a.addEventListener('scroll', onLeft, { passive: true })
    b.addEventListener('scroll', onRight, { passive: true })
    return () => {
      a.removeEventListener('scroll', onLeft)
      b.removeEventListener('scroll', onRight)
      cancelAnimationFrame(frame.current)
    }
  }, [enabled, sync])

  return { left, right }
}
