import type { StoredSource } from '@mycelia/store'
import { useState } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { relativeTime, truncatePath } from '../../shared/lib/format.js'
import { Button, Icon, IconButton, SkeletonRow } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

export function SourceList({
  sources,
  loading,
  activeId,
  onSelect,
  onAdd,
}: {
  sources: StoredSource[]
  loading: boolean
  activeId: string | null
  onSelect: (id: string | null) => void
  onAdd: () => void
}) {
  const app = useApp()
  const indexing = useApp((s) => s.indexing)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const reindex = async (id: string, force: boolean) => {
    setMenuFor(null)
    try {
      await window.mycelia.indexSource(id, force)
    } catch (error) {
      app.fail(error)
    }
  }

  const remove = async (id: string) => {
    setMenuFor(null)
    try {
      await window.mycelia.removeSource(id)
      if (activeId === id) onSelect(null)
      app.toast('已移除目录。磁盘上的文件没有被改动', 'success')
      app.bump()
    } catch (error) {
      app.fail(error)
    }
  }

  return (
    <div className="flex flex-col w-[204px] shrink-0 border-r border-border bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 h-[42px] shrink-0">
        <span className="text-[11px] font-medium text-muted">已挂载目录</span>
        <IconButton label="挂载已有目录" size="sm" onClick={onAdd}>
          <Icon name="plus" size={14} />
        </IconButton>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {loading && sources.length === 0 && (
          <div className="flex flex-col animate-fade-in">
            {Array.from({ length: 3 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
              <SkeletonRow key={index} index={index} avatar={false} className="h-[44px] px-2.5" />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            'flex items-center gap-2 w-full h-[30px] px-2.5 rounded-[7px] mb-1',
            'text-[12.5px] transition-colors duration-100',
            activeId === null ? 'bg-selected text-text' : 'text-muted hover:bg-hover',
          )}
        >
          <Icon name="search" size={13} className="shrink-0" />
          全部目录
        </button>

        {sources.map((source) => {
          const busy = indexing !== null && activeId === source.id
          return (
            <div key={source.id} className="relative">
              <button
                type="button"
                onClick={() => onSelect(source.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenuFor(menuFor === source.id ? null : source.id)
                }}
                className={cn(
                  'group flex flex-col gap-0.5 w-full px-2.5 py-1.5 rounded-[7px] text-left',
                  'transition-colors duration-100',
                  activeId === source.id ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Icon
                    name="folder"
                    size={13}
                    className={cn('shrink-0', source.enabled ? 'text-muted' : 'text-faint')}
                  />
                  <span className="text-[12.5px] truncate flex-1">{source.name}</span>
                  <IconButton
                    label="目录操作"
                    size="sm"
                    className="size-5 opacity-0 group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      setMenuFor(menuFor === source.id ? null : source.id)
                    }}
                  >
                    <Icon name="more" size={13} />
                  </IconButton>
                </span>

                <span className="text-[10.5px] text-faint tabular pl-[19px]">
                  {source.status === 'error' ? (
                    <span className="text-danger">索引失败</span>
                  ) : busy ? (
                    '索引中…'
                  ) : (
                    `${source.docCount} 文件 · ${source.chunkCount} 片段`
                  )}
                </span>
              </button>

              {menuFor === source.id && (
                <>
                  {/* 点任意处收起菜单。用 fixed 遮罩比全局 click 监听更好控制 */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: 纯粹的点击外部关闭层 */}
                  <div className="fixed inset-0 z-10" onMouseDown={() => setMenuFor(null)} />
                  <div
                    className={cn(
                      'absolute right-1 top-[38px] z-20 w-[168px] p-1',
                      'bg-overlay border border-border rounded-[8px] shadow-md animate-pop',
                    )}
                  >
                    <MenuItem icon="sync" onClick={() => reindex(source.id, false)}>
                      增量索引
                    </MenuItem>
                    <MenuItem icon="spark" onClick={() => reindex(source.id, true)}>
                      全量重建
                    </MenuItem>
                    <MenuItem
                      icon="external"
                      onClick={() => {
                        setMenuFor(null)
                        void window.mycelia.openPath(source.path)
                      }}
                    >
                      在访达中打开
                    </MenuItem>
                    <div className="h-px bg-border my-1" />
                    <MenuItem icon="trash" danger onClick={() => remove(source.id)}>
                      移除目录
                    </MenuItem>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {activeId && (
        <SourceFooter source={sources.find((item) => item.id === activeId)} onAdd={onAdd} />
      )}
    </div>
  )
}

function SourceFooter({ source, onAdd }: { source?: StoredSource; onAdd: () => void }) {
  if (!source) return null
  return (
    <div className="px-3 py-2.5 border-t border-border text-[10.5px] text-faint leading-relaxed shrink-0">
      <div className="truncate" title={source.path}>
        {truncatePath(source.path, 30)}
      </div>
      {source.lastIndexedAt && <div>索引于 {relativeTime(source.lastIndexedAt)}</div>}
      {source.error && <div className="text-danger mt-1 line-clamp-2">{source.error}</div>}
      <Button size="sm" variant="ghost" className="mt-1.5 -ml-2" onClick={onAdd}>
        挂载已有目录
      </Button>
    </div>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: 'sync' | 'spark' | 'external' | 'trash'
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full h-[27px] px-2 rounded-[5px]',
        'text-[12px] text-left transition-colors duration-100',
        danger ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-hover',
      )}
    >
      <Icon name={icon} size={13} className="shrink-0" />
      {children}
    </button>
  )
}
