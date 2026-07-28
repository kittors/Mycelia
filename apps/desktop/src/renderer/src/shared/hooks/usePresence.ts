import { useEffect, useState } from 'react'

/**
 * 带退场动画的挂载控制。
 *
 * React 的条件渲染是「立刻消失」，元素直接从 DOM 里拔掉，没有退场的机会 ——
 * 浮层因此总是弹出来很顺、关掉很硬。这里把卸载推迟到退场动画播完。
 *
 * 只管卸载时机，不管入场：入场交给 CSS animation 自动播。
 * 早先用 requestAnimationFrame 切类来触发入场过渡，但窗口失焦或被遮挡时
 * 浏览器会暂停 rAF，回调永远不来，浮层就一直停在初始的透明状态 ——
 * 表现为「鼠标悬停了，提示却不出现」。CSS animation 不受这个节流影响。
 */
export function usePresence(open: boolean, duration = 150) {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), duration)
    return () => clearTimeout(timer)
  }, [open, duration])

  return { mounted, exiting: mounted && !open }
}
