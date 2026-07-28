import { type RefObject, useEffect } from 'react'

/**
 * 让预览里的属性表与源码里的 front matter 一样高。
 *
 * 这两块表达的是同一段内容，但形态完全不同：源码那边是「键: 值」逐行铺开，
 * 预览这边是两列对齐的表格，同一个 description 在两边的换行位置不可能一致。
 * 高度一差，它后面的所有内容就全部错开 —— 分栏对齐的价值也就没了。
 *
 * 所以不去猜行数，直接量：源码里 front matter 占多高，就把属性表撑到多高。
 * 换行、字号、窗口宽度怎么变都跟得上。
 */
export function useFrontMatterAlign(
  left: RefObject<HTMLDivElement | null>,
  right: RefObject<HTMLDivElement | null>,
  /** 源文里 front matter 的逻辑行数，0 表示没有 */
  lineCount: number,
  enabled: boolean,
): void {
  useEffect(() => {
    const table = right.current?.querySelector<HTMLElement>('.front-matter')
    if (!table) return

    // 非分栏时不必对齐，反而该让它保持自然高度
    if (!enabled || lineCount === 0) {
      table.style.removeProperty('height')
      return
    }

    const measure = () => {
      const lines = left.current?.querySelectorAll<HTMLElement>('.cm-line')
      if (!lines || lines.length < lineCount) return
      const first = lines[0]
      const last = lines[lineCount - 1]
      if (!first || !last) return

      const height = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top
      if (height > 0) table.style.height = `${Math.round(height)}px`
    }

    measure()

    /**
     * 宽度一变，源码那边的换行就变，高度跟着变。
     *
     * 监听左栏而不是窗口：拖动分栏、侧边栏收起都不会触发 window 的 resize，
     * 但左栏的尺寸实实在在变了。
     */
    const observer = new ResizeObserver(measure)
    if (left.current) observer.observe(left.current)
    return () => observer.disconnect()
  })
}

/** 数一数源文开头的 front matter 占几行（含两道 ---） */
export function frontMatterLines(source: string): number {
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return 0
  return match[0].replace(/\r?\n$/, '').split(/\r?\n/).length
}
