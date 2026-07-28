import { useEffect, useState } from 'react'
import { cn } from '../shared/lib/cn.js'
import { Icon } from '../shared/ui/index.js'
import { useApp } from '../store/app-store.js'
import { SaveIndicator } from './components.js'
import { type PaneId, paneMeta, SETTINGS_NAV } from './nav.js'
import { AboutPane } from './panes/AboutPane.js'
import { AgentsPane } from './panes/AgentsPane.js'
import { AppearancePane } from './panes/AppearancePane.js'
import { CapturePane } from './panes/CapturePane.js'
import { KnowledgePane } from './panes/KnowledgePane.js'
import { ModelsPane } from './panes/ModelsPane.js'

const PANES: Record<PaneId, () => React.ReactElement> = {
  agents: AgentsPane,
  models: ModelsPane,
  capture: CapturePane,
  knowledge: KnowledgePane,
  appearance: AppearancePane,
  about: AboutPane,
}

/**
 * 设置。
 *
 * 覆盖在主界面之上的一层，而不是独立窗口 —— 独立窗口意味着两个 React 根、
 * 两份状态，在设置里改主题主界面收不到。共用窗口就共用同一份 store，
 * 主题这类全局设置改完立刻在两边生效。
 *
 * 左上角的「返回」固定不动：它是这一层唯一的出口，
 * 跟着导航一起滚出视野的话，用户会找不到怎么退出去。
 */
export function SettingsScreen() {
  const close = useApp((s) => s.openSettings)
  const [pane, setPane] = useState<PaneId>('agents')

  // Esc 退出。这一层是模态性质的，用户的第一反应就是按 Esc
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  const meta = paneMeta(pane)
  const Pane = PANES[pane]

  return (
    /**
     * 容器不做透明度动画：整层淡入时连它的背景一起半透明，
     * 下面的主界面会透出来，两层文字叠在一起。
     * 背景必须立刻实心，进场感交给内部元素。
     */
    <div className="absolute inset-0 z-40 flex bg-canvas">
      <aside className="flex flex-col w-[196px] shrink-0 bg-surface animate-fade-in">
        {/* macOS 红绿灯占位 */}
        <div className="h-[38px] shrink-0 drag-region" />

        {/* 返回固定在顶部，不随下方导航滚动 */}
        <div className="px-2 pb-2 shrink-0">
          <button
            type="button"
            onClick={() => close(false)}
            className={cn(
              'group flex items-center gap-2 w-full h-[30px] px-2.5 rounded-[7px]',
              'text-[13px] font-medium text-text',
              'bg-hover hover:bg-active transition-colors duration-150',
            )}
          >
            <Icon
              name="chevron"
              size={14}
              className="rotate-180 shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5"
            />
            返回
          </button>
        </div>

        <nav className="flex flex-col flex-1 min-h-0 overflow-y-auto px-2 pb-3">
          {SETTINGS_NAV.map((group, index) => (
            <div key={group.label} className={cn(index > 0 && 'mt-3')}>
              <div className="px-2.5 pb-1 text-[10.5px] font-medium text-faint tracking-wide">
                {group.label}
              </div>
              <div className="flex flex-col gap-[1px]">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPane(item.id)}
                    aria-current={pane === item.id ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-2.5 w-full h-[29px] px-2.5 rounded-[7px]',
                      'text-[13px] transition-colors duration-150',
                      pane === item.id
                        ? 'bg-selected text-text font-medium'
                        : 'text-muted hover:text-text hover:bg-hover',
                    )}
                  >
                    <Icon
                      name={item.icon}
                      size={15}
                      className={cn(
                        'shrink-0 transition-opacity',
                        pane === item.id ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
                      )}
                    />
                    <span className="flex-1 min-w-0 text-left truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex flex-col flex-1 min-w-0 border-l border-border animate-fade-in">
        <header className="flex items-center gap-2.5 h-[46px] shrink-0 px-5 border-b border-border drag-region">
          <Icon name={meta.icon} size={16} className="text-muted shrink-0" />
          <h1 className="text-[13.5px] font-medium">{meta.label}</h1>
          <span className="text-[11.5px] text-faint truncate">{meta.description}</span>
          <div className="flex-1" />
          {/* 设置实时生效，这里只做「存下了」的反馈，不是操作入口 */}
          <SaveIndicator />
        </header>

        {/* key 让切换面板时重新挂载，各面板不必清理上一个的表单状态 */}
        <div key={pane} className="flex-1 min-h-0 overflow-y-auto animate-fade-in">
          <Pane />
        </div>
      </main>
    </div>
  )
}
