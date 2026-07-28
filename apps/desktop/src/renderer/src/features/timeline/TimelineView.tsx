import { useAsync } from '../../shared/hooks/useAsync.js'
import { cn } from '../../shared/lib/cn.js'
import { kindColor } from '../../shared/lib/labels.js'
import { Badge, Empty, Icon, KindDot, Skeleton, SkeletonText } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

/** 按周回看沉淀轨迹。左侧是一条连续的时间轴，视觉上把离散的周串起来 */
export function TimelineView() {
  const revision = useApp((s) => s.revision)
  const setView = useApp((s) => s.setView)
  const { data, loading } = useAsync(() => window.mycelia.getTimeline(16), [revision])

  const entries = data ?? []

  if (loading && entries.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-5 max-w-[760px] animate-fade-in">
        {Array.from({ length: 3 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
          <div key={index} className="flex gap-4">
            <Skeleton className="size-[7px] rounded-full mt-[7px] shrink-0" />
            <div className="flex flex-col gap-2.5 flex-1">
              <Skeleton className="h-[10px] w-[30%] rounded-full" />
              <SkeletonText lines={3} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty
          icon={<Icon name="timeline" size={28} />}
          title="时间线还是空的"
          description="有记忆沉淀之后，每周的脉络会在这里汇合。"
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[760px] px-5 py-5">
        {entries.map((entry, index) => (
          <section key={entry.weekStart} className="relative flex gap-4 pb-7">
            {/* 时间轴：竖线 + 节点。最后一条不画线，否则会拖出一截空尾巴 */}
            <div className="relative flex flex-col items-center shrink-0 w-[10px]">
              <span className="size-[7px] rounded-full bg-border-strong mt-[7px] shrink-0" />
              {index < entries.length - 1 && (
                <span className="flex-1 w-px bg-border mt-1.5" aria-hidden="true" />
              )}
            </div>

            <div className="flex-1 min-w-0 stagger" style={{ animationDelay: `${index * 40}ms` }}>
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[13px] font-medium">{entry.weekLabel}</h2>
                <span className="text-[11px] text-faint tabular">
                  {entry.memories.length} 条记忆
                  {entry.sessionCount > 0 && ` · ${entry.sessionCount} 次会话`}
                </span>
              </div>

              {entry.projects.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {entry.projects.slice(0, 6).map((project) => (
                    <Badge key={project.name}>
                      {project.name}
                      <span className="text-faint tabular">{project.count}</span>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex flex-col mt-2 -mx-2">
                {entry.memories.slice(0, 8).map((memory) => (
                  <button
                    key={memory.id}
                    type="button"
                    onClick={() => setView('memories')}
                    className={cn(
                      'flex items-center gap-2.5 px-2 h-[28px] rounded-[6px] text-left',
                      'hover:bg-hover transition-colors duration-100',
                    )}
                  >
                    <KindDot color={kindColor(memory.kind)} size={5} />
                    <span className="text-[12px] truncate flex-1">{memory.title}</span>
                  </button>
                ))}
                {entry.memories.length > 8 && (
                  <span className="px-2 pt-1 text-[11px] text-faint">
                    还有 {entry.memories.length - 8} 条
                  </span>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
