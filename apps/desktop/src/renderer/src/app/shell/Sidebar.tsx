import { cn } from '../../shared/lib/cn.js'
import { Icon, type IconName } from '../../shared/ui/index.js'
import { useApp, type ViewId } from '../../store/app-store.js'

interface NavItem {
  id: ViewId
  label: string
  icon: IconName
}

interface NavGroup {
  /** 分组标题。null 表示不带标题的置顶项 */
  label: string | null
  items: readonly NavItem[]
}

/**
 * 导航分组。
 *
 * 分组不是为了好看 —— 八个平铺项没有层次，用户每次都要从头扫一遍。
 * 按「看什么」和「处理什么」切开之后，找目标只需要先定位到组。
 *
 * 设置不在这里：它是低频的一次性配置，和日常浏览不是一类动作，
 * 放进主导航只会占据最显眼的位置却几乎不被点。它在侧栏底部。
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: null,
    items: [{ id: 'overview', label: '概览', icon: 'home' }],
  },
  {
    label: '知识库',
    items: [
      { id: 'graph', label: '知识图谱', icon: 'graph' },
      { id: 'memories', label: '记忆库', icon: 'memory' },
      { id: 'library', label: '文档库', icon: 'library' },
    ],
  },
  {
    label: '整理',
    items: [
      { id: 'review', label: '待确认', icon: 'inbox' },
      { id: 'timeline', label: '时间线', icon: 'timeline' },
      { id: 'vault', label: '保险箱', icon: 'vault' },
    ],
  },
]

/** 扁平列表，供顶栏标题与命令面板查找 */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

export function Sidebar() {
  const view = useApp((s) => s.view)
  const pending = useApp((s) => s.dashboard?.stats.pending ?? 0)
  const total = useApp((s) => s.dashboard?.stats.total ?? 0)
  const chunks = useApp((s) => s.dashboard?.knowledge.chunks ?? 0)

  return (
    <aside className="flex flex-col w-[188px] shrink-0 bg-surface">
      {/* macOS 红绿灯占位。窗口无边框，这块必须能拖 */}
      <div className="h-[38px] shrink-0 drag-region" />

      <div className="px-3 pb-3 drag-region">
        <div className="flex items-center gap-2 no-drag">
          <Logo />
          <span className="text-[13px] font-semibold tracking-tight">Mycelia</span>
        </div>
      </div>

      <nav className="flex flex-col flex-1 min-h-0 overflow-y-auto px-2" aria-label="主导航">
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label ?? 'root'} className={cn(index > 0 && 'mt-3')}>
            {group.label && (
              <div className="px-2.5 pb-1 text-[10.5px] font-medium text-faint tracking-wide">
                {group.label}
              </div>
            )}
            <div className="flex flex-col gap-[1px]">
              {group.items.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={view === item.id}
                  badge={item.id === 'review' && pending > 0 ? pending : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-1.5 px-2 pt-2 pb-2.5 border-t border-border shrink-0">
        <div className="px-2.5 text-[10.5px] text-faint leading-[1.5] tabular">
          <div>{total} 条记忆</div>
          <div>{chunks} 个文档片段</div>
        </div>
        {/* 设置是独立窗口：它是偶尔进去改一次就关掉的，
            和常驻查阅的主界面不是一个使用节奏 */}
        <button
          type="button"
          onClick={() => useApp.getState().openSettings(true)}
          className={cn(
            'group flex items-center gap-2.5 w-full h-[29px] px-2.5 rounded-[7px]',
            'text-[13px] text-muted hover:text-text hover:bg-hover transition-colors duration-150',
          )}
        >
          <Icon name="settings" size={15} className="shrink-0 opacity-70 group-hover:opacity-100" />
          <span className="flex-1 text-left">设置</span>
          <kbd className="text-[10px] text-faint">⌘,</kbd>
        </button>
      </div>
    </aside>
  )
}

function NavButton({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  const setView = useApp((s) => s.setView)
  return (
    <button
      type="button"
      onClick={() => setView(item.id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2.5 w-full h-[29px] px-2.5 rounded-[7px]',
        'text-[13px] transition-colors duration-150',
        active ? 'bg-selected text-text font-medium' : 'text-muted hover:text-text hover:bg-hover',
      )}
    >
      <Icon
        name={item.icon}
        size={15}
        className={cn(
          'shrink-0 transition-opacity',
          active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
        )}
      />
      <span className="flex-1 min-w-0 text-left truncate">{item.label}</span>
      {badge !== undefined && (
        <span className="tabular text-[11px] font-medium text-warning">{badge}</span>
      )}
    </button>
  )
}

/**
 * 菌丝网络的标记：一个中心节点连出三条支线。
 * 用 SVG 而不是位图，深浅主题下都跟着 currentColor 走。
 */
function Logo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <title>Mycelia</title>
      <path
        d="M8 8 3.5 4.5M8 8l4.8-2.2M8 8l-1.6 5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" />
      <circle cx="3.2" cy="4.2" r="1.25" fill="currentColor" opacity="0.75" />
      <circle cx="13.1" cy="5.5" r="1.25" fill="currentColor" opacity="0.75" />
      <circle cx="6.2" cy="13.4" r="1.25" fill="currentColor" opacity="0.75" />
    </svg>
  )
}
