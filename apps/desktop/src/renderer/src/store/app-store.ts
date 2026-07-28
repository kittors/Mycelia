import type { Config } from '@mycelia/shared'
import { create } from 'zustand'
import type { DashboardData } from '../../../shared/ipc-contract.js'
import { errorMessage } from '../shared/lib/format.js'

export type ViewId = 'overview' | 'graph' | 'memories' | 'library' | 'review' | 'timeline' | 'vault'

export type ThemeMode = 'system' | 'dark' | 'light'

/** 设置是实时保存的，这是那次写盘的状态 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'danger'
}

interface AppState {
  view: ViewId
  theme: ThemeMode
  dashboard: DashboardData | null
  config: Config | null

  syncing: boolean
  syncProgress: { done: number; total: number; current: string } | null
  indexing: { done: number; total: number; current: string } | null

  toasts: Toast[]
  composerOpen: boolean
  paletteOpen: boolean
  /**
   * 设置层是否展开。
   *
   * 设置和主界面共用一个窗口、共用这一份 store —— 独立窗口时它们各有各的
   * React 根，在设置里改主题主界面收不到，这是那个方案真正的代价。
   */
  settingsOpen: boolean
  configSave: SaveState

  /**
   * 数据版本号。任何写操作后自增，各视图把它放进 useAsync 的依赖里，
   * 就能在不互相引用的前提下统一刷新 —— 视图之间不需要知道彼此存在。
   */
  revision: number

  setView: (view: ViewId) => void
  setTheme: (theme: ThemeMode) => void
  setDashboard: (dashboard: DashboardData | null) => void
  setConfig: (config: Config | null) => void
  setSyncing: (syncing: boolean) => void
  setSyncProgress: (progress: AppState['syncProgress']) => void
  setIndexing: (progress: AppState['indexing']) => void
  openComposer: (open: boolean) => void
  openPalette: (open: boolean) => void
  openSettings: (open: boolean) => void
  setConfigSave: (state: SaveState) => void
  bump: () => void
  toast: (message: string, tone?: Toast['tone']) => void
  fail: (error: unknown) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useApp = create<AppState>((set) => ({
  view: 'overview',
  theme: 'system',
  dashboard: null,
  config: null,
  syncing: false,
  syncProgress: null,
  indexing: null,
  toasts: [],
  composerOpen: false,
  paletteOpen: false,
  settingsOpen: false,
  configSave: 'idle',
  revision: 0,

  setView: (view) => set({ view }),
  setTheme: (theme) => set({ theme }),
  setDashboard: (dashboard) => set({ dashboard }),
  setConfig: (config) => set({ config }),
  setSyncing: (syncing) => set({ syncing }),
  setSyncProgress: (syncProgress) => set({ syncProgress }),
  setIndexing: (indexing) => set({ indexing }),
  openComposer: (composerOpen) => set({ composerOpen }),
  openPalette: (paletteOpen) => set({ paletteOpen }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  setConfigSave: (configSave) => set({ configSave }),
  bump: () => set((state) => ({ revision: state.revision + 1 })),

  toast: (message, tone = 'info') =>
    set((state) => ({ toasts: [...state.toasts, { id: ++toastSeq, message, tone }] })),
  fail: (error) =>
    set((state) => ({
      toasts: [...state.toasts, { id: ++toastSeq, message: errorMessage(error), tone: 'danger' }],
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

/** 把主题偏好落到 <html data-theme>，system 时跟随系统并持续监听 */
export function applyTheme(mode: ThemeMode): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const resolve = () => {
    const dark = mode === 'dark' || (mode === 'system' && media.matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }
  resolve()
  if (mode !== 'system') return () => undefined
  media.addEventListener('change', resolve)
  return () => media.removeEventListener('change', resolve)
}
