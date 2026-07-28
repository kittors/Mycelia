import type { Config } from '@mycelia/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAsync } from '../shared/hooks/useAsync.js'
import { useApp } from '../store/app-store.js'

export interface LiveConfig {
  config: Config | null
  /** 改顶层字段，立即生效 */
  patch: (next: Partial<Config>) => void
  /** 改某个配置段，立即生效 */
  patchSection: <K extends keyof Config>(key: K, next: Partial<Config[K]>) => void
}

/**
 * 实时生效的配置。
 *
 * 设置没有「保存」按钮 —— 改完就是改完了。一个需要点保存的设置页，
 * 用户每次都要多想一步「我改的到底生效没有」，而这一步本来不必存在。
 *
 * 两个细节让它成立：
 *
 *   1. **乐观更新**。本地状态立刻变，UI 不等 IPC 往返。
 *      主题这类所见即所得的设置尤其明显：点了就变，没有延迟感。
 *
 *   2. **写盘防抖**。数字输入框每敲一个字符都触发一次写盘是浪费，
 *      而且中间态（比如把 900 删成空再输 1200）不该被持久化。
 *      离散控件（开关、分段）本来也会走这条路径，300ms 对它们无感。
 *
 * 写失败会回滚到服务端的真实值并提示，避免界面显示的和实际存的不一致。
 */
export function useLiveConfig(): LiveConfig {
  const app = useApp()
  const { data: loaded } = useAsync(() => window.mycelia.getConfig(), [])

  const [config, setConfig] = useState<Config | null>(null)
  const setState = useApp((s) => s.setConfigSave)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Config | null>(null)

  useEffect(() => {
    if (loaded) setConfig(loaded)
  }, [loaded])

  // 卸载时把没写完的改动落盘，否则用户改完立刻返回会丢
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) void window.mycelia.setConfig(pending.current)
    }
  }, [])

  const schedule = useCallback(
    (next: Config) => {
      pending.current = next
      setState('saving')
      if (timer.current) clearTimeout(timer.current)

      timer.current = setTimeout(async () => {
        try {
          const saved = await window.mycelia.setConfig(next)
          pending.current = null
          setConfig(saved)
          app.setConfig(saved)
          app.setTheme(saved.theme)
          setState('saved')
          // 「已保存」提示留一会儿就淡出，长期挂着反而是噪音
          setTimeout(() => setState('idle'), 1600)
        } catch (error) {
          pending.current = null
          setState('error')
          app.fail(error)
          // 回滚到服务端真实值，别让界面显示的和实际存的不一致
          void window.mycelia
            .getConfig()
            .then(setConfig)
            .catch(() => undefined)
        }
      }, 300)
    },
    [app, setState],
  )

  const patch = useCallback(
    (next: Partial<Config>) => {
      setConfig((current) => {
        if (!current) return current
        const updated = { ...current, ...next }
        schedule(updated)
        return updated
      })
    },
    [schedule],
  )

  const patchSection = useCallback(
    <K extends keyof Config>(key: K, next: Partial<Config[K]>) => {
      setConfig((current) => {
        if (!current) return current
        const updated = { ...current, [key]: { ...(current[key] as object), ...next } }
        schedule(updated)
        return updated
      })
    },
    [schedule],
  )

  return { config, patch, patchSection }
}
