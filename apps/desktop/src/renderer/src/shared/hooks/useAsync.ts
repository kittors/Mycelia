import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/format.js'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * IPC 数据加载。
 *
 * 关键是竞态防护：用户快速切换筛选时会连发几个请求，返回顺序不保证。
 * 每次调用记一个序号，只有最新那次的结果允许写进 state ——
 * 否则会出现「选了 A，界面却显示 B 的结果」。
 */
export function useAsync<T>(loader: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const runId = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // loader 每次渲染都是新函数，用 ref 存住，避免它进依赖数组导致死循环
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps 由调用方显式声明，这正是本 hook 的契约
  useEffect(() => {
    const id = ++runId.current
    setLoading(true)
    setError(null)

    loaderRef
      .current()
      .then((result) => {
        if (id !== runId.current || !mounted.current) return
        setData(result)
        setLoading(false)
      })
      .catch((cause) => {
        if (id !== runId.current || !mounted.current) return
        setError(errorMessage(cause))
        setLoading(false)
      })
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { data, loading, error, reload }
}

/** 防抖值。搜索框每次按键都发 IPC 太浪费，等用户停下来再查 */
export function useDebounced<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
