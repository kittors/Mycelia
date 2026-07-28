import { create } from 'zustand'

/**
 * 二次确认。
 *
 * 做成命令式的 `await confirm({...})` 而不是一个要自己管开关状态的组件：
 * 需要确认的地方几乎都在事件处理器里 —— 删一条记忆、移除一个挂载目录 ——
 * 用组件写法就得为每个入口配一个 useState、一个 pendingId、一个 onConfirm，
 * 而真正的逻辑只有一行。这跟 app.toast 的取舍是同一个。
 *
 * 不用 window.confirm：它长的是系统的样子，跟这套界面毫无关系，
 * 而且会真的冻住渲染线程。
 */

export interface ConfirmOptions {
  title: string
  /** 补充说明。写清楚「会发生什么」和「什么不会被动到」，比反问一句更有用 */
  body?: string
  confirmText?: string
  cancelText?: string
  /** 破坏性操作：确认键变红，且焦点默认落在取消上，免得回车顺手就按下去 */
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  id: number
  settle: (ok: boolean) => void
}

interface ConfirmState {
  pending: Pending | null
  open: (options: ConfirmOptions) => Promise<boolean>
  answer: (ok: boolean) => void
}

let seq = 0

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,

  open: (options) =>
    new Promise<boolean>((resolve) => {
      /**
       * 前一个还没答就来了新的：把旧的当作取消结掉。
       * 不结的话那个 promise 永远悬着，等它的调用方就卡死了。
       */
      get().pending?.settle(false)
      set({ pending: { ...options, id: ++seq, settle: resolve } })
    }),

  answer: (ok) => {
    const pending = get().pending
    if (!pending) return
    set({ pending: null })
    pending.settle(ok)
  },
}))

/** 在任意位置直接调用，不必是组件内 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().open(options)
}
