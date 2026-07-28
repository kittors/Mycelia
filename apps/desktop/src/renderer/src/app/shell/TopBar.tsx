import { cn } from '../../shared/lib/cn.js'
import { Button, Icon, IconButton, Spinner } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'
import { NAV_ITEMS } from './Sidebar.js'

export function TopBar() {
  const view = useApp((s) => s.view)
  const syncing = useApp((s) => s.syncing)
  const syncProgress = useApp((s) => s.syncProgress)
  const indexing = useApp((s) => s.indexing)
  const openPalette = useApp((s) => s.openPalette)
  const openComposer = useApp((s) => s.openComposer)

  const title = NAV_ITEMS.find((item) => item.id === view)?.label ?? ''
  const busy = syncing || indexing !== null
  const progress = indexing ?? syncProgress

  return (
    <header
      className={cn(
        'relative flex items-center gap-2 h-[46px] shrink-0 px-3',
        'border-b border-border drag-region',
      )}
    >
      <h1 className="text-[13px] font-medium truncate">{title}</h1>

      {busy && (
        <span className="flex items-center gap-1.5 text-[11.5px] text-faint min-w-0 no-drag">
          <Spinner />
          <span className="truncate max-w-[240px]">
            {progress?.current || (indexing ? '正在索引' : '正在导入')}
            {progress?.total ? ` · ${progress.done}/${progress.total}` : ''}
          </span>
        </span>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 no-drag">
        <button
          type="button"
          onClick={() => openPalette(true)}
          className={cn(
            'flex items-center gap-2 h-7 pl-2 pr-1.5 rounded-[7px]',
            'bg-sunken border border-border text-faint',
            'hover:border-border-strong hover:text-muted transition-colors duration-150',
          )}
        >
          <Icon name="search" size={13} />
          <span className="text-[12px] w-[110px] text-left">搜索…</span>
          <kbd
            className={cn(
              'flex items-center h-[17px] px-1 rounded-[4px] bg-raised',
              'text-[10.5px] font-medium text-faint border border-border',
            )}
          >
            ⌘K
          </kbd>
        </button>

        <IconButton label="新建记忆" size="sm" onClick={() => openComposer(true)}>
          <Icon name="plus" size={15} />
        </IconButton>
      </div>

      {/* 进度条贴在底边线上，不占布局高度 */}
      {busy && (
        <span
          aria-hidden="true"
          className="absolute left-0 bottom-[-1px] h-[1.5px] bg-accent transition-[width] duration-300 ease-out"
          style={{
            width: progress?.total
              ? `${Math.max(3, (progress.done / progress.total) * 100)}%`
              : '22%',
          }}
        />
      )}
    </header>
  )
}

/** 视图内的页头。各视图自己的操作按钮挂在这里，与全局 TopBar 分开 */
export function ViewHeader({
  description,
  actions,
  children,
}: {
  description?: string
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        {description && <p className="text-[12px] text-faint leading-snug">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  )
}

export { Button }
