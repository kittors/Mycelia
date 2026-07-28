import { useEffect, useState } from 'react'

/**
 * 延迟置真的标志位。
 *
 * 专治骨架屏闪烁：agent 探测、配置读取这类操作通常几十毫秒就回来了，
 * 骨架亮一下又消失，比全程不放骨架还难受 —— 用户只看到一片灰色抽了一下。
 *
 * 只有加载真的慢到人能察觉（默认 260ms）才显示骨架。
 * 快的时候直接出内容，界面是「秒开」而不是「闪一下再开」。
 */
export function useDelayedFlag(active: boolean, delay = 260): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!active) {
      setShown(false)
      return
    }
    const timer = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(timer)
  }, [active, delay])

  return shown
}
