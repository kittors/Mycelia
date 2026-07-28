import { type RefObject, useEffect, useState } from 'react'

/**
 * 等容器真的有尺寸。
 *
 * Sigma 在零宽容器上建出来的渲染器，相机参数全是错的，之后容器撑开了
 * 也不会自己纠正 —— 表现是图缩在角落或者干脆看不见。更早的版本它还会
 * 直接抛异常，顺着 React 渲染栈把整棵组件树炸掉（白屏）。
 *
 * 触发场景比想象的多：应用启动时正好停在图谱页、窗口从最小化恢复、
 * 布局还差一帧。所以宁可等一等再建。
 */
export function useContainerReady(ref: RefObject<HTMLElement | null>): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (element.offsetWidth > 0 && element.offsetHeight > 0) {
      setReady(true)
      return
    }

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box || box.width === 0 || box.height === 0) return
      observer.disconnect()
      setReady(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return ready
}
