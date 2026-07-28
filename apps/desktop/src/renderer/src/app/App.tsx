import { useEffect } from 'react'
import type { MainEvent } from '../../../shared/ipc-contract.js'
import { GraphView } from '../features/graph/GraphView.js'
import { KnowledgeView } from '../features/knowledge/KnowledgeView.js'
import { MemoriesView } from '../features/memories/MemoriesView.js'
import { MemoryComposer } from '../features/memories/MemoryComposer.js'
import { OverviewView } from '../features/overview/OverviewView.js'
import { ReviewView } from '../features/review/ReviewView.js'
import { TimelineView } from '../features/timeline/TimelineView.js'
import { VaultView } from '../features/vault/VaultView.js'
import { SettingsScreen } from '../settings/SettingsScreen.js'
import { applyTheme, useApp, type ViewId } from '../store/app-store.js'
import { CommandPalette } from './shell/CommandPalette.js'
import { Sidebar } from './shell/Sidebar.js'
import { Toaster } from './shell/Toaster.js'
import { TopBar } from './shell/TopBar.js'

const VIEWS: Record<ViewId, () => React.ReactElement> = {
  overview: OverviewView,
  graph: GraphView,
  memories: MemoriesView,
  library: KnowledgeView,
  review: ReviewView,
  timeline: TimelineView,
  vault: VaultView,
}

export default function App() {
  const view = useApp((s) => s.view)
  const theme = useApp((s) => s.theme)
  const composerOpen = useApp((s) => s.composerOpen)
  const paletteOpen = useApp((s) => s.paletteOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)

  // ── 主题 ──
  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => {
    void window.mycelia
      .getConfig()
      .then((config) => {
        useApp.getState().setConfig(config)
        useApp.getState().setTheme(config.theme)
      })
      .catch(() => undefined)
  }, [])

  // ── 首屏数据 ──
  const revision = useApp((s) => s.revision)
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision 是刷新触发器，store 的 action 是稳定引用
  useEffect(() => {
    void window.mycelia
      .getDashboard()
      .then(useApp.getState().setDashboard)
      .catch(useApp.getState().fail)
  }, [revision])

  // ── 主进程事件 ──
  useEffect(
    () =>
      window.mycelia.onEvent((event: MainEvent) => {
        const app = useApp.getState()
        switch (event.type) {
          case 'navigate':
            if (event.view in VIEWS) app.setView(event.view as ViewId)
            break
          case 'command':
            if (event.action === 'new-memory') app.openComposer(true)
            if (event.action === 'palette') app.openPalette(true)
            if (event.action === 'settings') app.openSettings(true)
            break
          case 'sync:start':
            app.setSyncing(true)
            app.setSyncProgress(null)
            break
          case 'sync:progress':
            app.setSyncProgress(event)
            break
          case 'sync:complete':
            app.setSyncing(false)
            app.setSyncProgress(null)
            app.toast(`导入完成，新增 ${event.summary.created} 条记忆`, 'success')
            app.bump()
            break
          case 'sync:error':
            app.setSyncing(false)
            app.setSyncProgress(null)
            app.toast(event.message, 'danger')
            break
          case 'index:start':
            app.setIndexing({ done: 0, total: 0, current: '' })
            break
          case 'index:progress':
            app.setIndexing(event)
            break
          case 'index:complete': {
            app.setIndexing(null)
            const { indexedDocuments, createdChunks, skippedDocuments } = event.result
            app.toast(
              indexedDocuments === 0
                ? `索引完成，${skippedDocuments} 个文件无变化`
                : `索引完成，${indexedDocuments} 个文件 · ${createdChunks} 个片段`,
              'success',
            )
            app.bump()
            break
          }
          case 'index:error':
            app.setIndexing(null)
            app.toast(event.message, 'danger')
            break
          case 'memories:changed':
          case 'vault:changed':
            app.bump()
            break
        }
      }),
    [],
  )

  // ── 全局快捷键 ──
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        useApp.getState().openPalette(true)
        return
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        useApp.getState().openComposer(true)
        return
      }
      if (meta && event.key === ',') {
        event.preventDefault()
        useApp.getState().openSettings(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const ActiveView = VIEWS[view]

  return (
    <div className="relative flex h-full bg-canvas text-text">
      <Sidebar />
      <main className="flex flex-col flex-1 min-w-0 border-l border-border">
        <TopBar />
        {/* key 让视图切换时重新挂载，各视图不必自己清理上一个视图的残留状态 */}
        <div key={view} className="flex-1 min-h-0 animate-fade-in">
          <ActiveView />
        </div>
      </main>

      {settingsOpen && <SettingsScreen />}
      {composerOpen && <MemoryComposer />}
      {paletteOpen && <CommandPalette />}
      <Toaster />
    </div>
  )
}
