import type { StoredMemory } from '@mycelia/store'
import { cn } from '../../shared/lib/cn.js'
import { formatNumber, relativeTime } from '../../shared/lib/format.js'
import { agentName, kindColor } from '../../shared/lib/labels.js'
import { AgentIcon } from '../../shared/ui/AgentIcon.js'
import {
  Badge,
  Button,
  Empty,
  Icon,
  KindDot,
  SectionHeader,
  Skeleton,
  SkeletonRow,
  SkeletonText,
  Truncate,
} from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'
import { ActivityHeatmap } from './ActivityHeatmap.js'

/**
 * 概览。
 *
 * 回答三个问题，按重要性排：
 *   1. 我的知识库现在有多大（三层各多少）
 *   2. 有什么在等我处理
 *   3. agent 接好了没有
 */
export function OverviewView() {
  const dashboard = useApp((s) => s.dashboard)
  const setView = useApp((s) => s.setView)

  if (!dashboard) {
    // 骨架照着真实版式摆：四格统计 + 左右两栏。
    // 内容到达时位置几乎不动，不会整页重排一次
    return (
      <div className="flex flex-col gap-6 px-5 py-5 max-w-[1080px] animate-fade-in">
        <div className="grid grid-cols-4 gap-px bg-border border border-border rounded-[10px] overflow-hidden">
          {Array.from({ length: 4 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
            <div key={index} className="flex flex-col gap-2 px-3.5 py-3 bg-surface">
              <Skeleton className="h-[8px] w-12 rounded-full" />
              <Skeleton className="h-[18px] w-10 rounded-full" />
              <Skeleton className="h-[8px] w-20 rounded-full" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6 items-start">
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-[9px] w-16 rounded-full" />
            {Array.from({ length: 6 }, (_, index) => (
              <SkeletonRow
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
                key={index}
                index={index}
                avatar={false}
                trailing="text"
                className="h-[32px] px-0"
              />
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-[9px] w-16 rounded-full" />
            <SkeletonText lines={4} />
          </div>
        </div>
      </div>
    )
  }

  const { stats, knowledge, agents, pending, recent, activity } = dashboard
  const connected = agents.filter((agent) => agent.installed).length

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="flex flex-col gap-6 px-5 py-5 max-w-[1080px]">
        {/* ── 三层知识库的规模 ── */}
        <section className="grid grid-cols-4 gap-px bg-border border border-border rounded-[10px] overflow-hidden">
          <Stat
            label="长期记忆"
            value={stats.total}
            note={`${stats.embedded} 条已向量化`}
            onClick={() => setView('memories')}
          />
          <Stat
            label="文档片段"
            value={knowledge.chunks}
            note={`${knowledge.documents} 个文件 · ${knowledge.sources} 个目录`}
            onClick={() => setView('library')}
          />
          <Stat
            label="待确认"
            value={stats.pending}
            note={stats.pending > 0 ? '需要你判断' : '队列已清空'}
            tone={stats.pending > 0 ? 'warning' : undefined}
            onClick={() => setView('review')}
          />
          <Stat
            label="已接入 agent"
            value={connected}
            note={`共 ${agents.length} 个可用`}
            onClick={() => useApp.getState().openSettings(true)}
          />
        </section>

        <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6 items-start">
          {/* ── 最近沉淀 ── */}
          <section className="flex flex-col gap-1.5 min-w-0">
            <SectionHeader
              title="最近沉淀"
              action={
                <Button size="sm" variant="ghost" onClick={() => setView('memories')}>
                  全部
                  <Icon name="chevron" size={12} />
                </Button>
              }
            />
            {recent.length === 0 ? (
              <Empty
                icon={<Icon name="memory" size={24} />}
                title="还没有记忆"
                description="给 agent 装上 Mycelia，它会在对话里把值得留存的结论写进来。"
                action={
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => useApp.getState().openSettings(true)}
                  >
                    去接入
                  </Button>
                }
                className="border border-dashed border-border rounded-[10px] py-10"
              />
            ) : (
              <div className="flex flex-col -mx-2">
                {recent.slice(0, 7).map((memory: StoredMemory, index: number) => (
                  <button
                    key={memory.id}
                    type="button"
                    onClick={() => setView('memories')}
                    className={cn(
                      'flex items-center gap-2.5 px-2 h-[32px] rounded-[7px] text-left',
                      'hover:bg-hover transition-colors duration-100 stagger',
                    )}
                    style={{ animationDelay: `${index * 22}ms` }}
                  >
                    <KindDot color={kindColor(memory.kind)} />
                    <Truncate className="text-[12.5px] flex-1">{memory.title}</Truncate>
                    <Truncate className="text-[10.5px] text-faint max-w-[100px]">
                      {memory.origin.project ?? agentName(memory.origin.agent)}
                    </Truncate>
                    <span className="text-[10.5px] text-faint tabular shrink-0 w-[46px] text-right">
                      {relativeTime(memory.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="flex flex-col gap-6 min-w-0">
            {/* ── 待确认 ── */}
            <section className="flex flex-col gap-1.5">
              <SectionHeader
                title="等待确认"
                count={stats.pending}
                action={
                  stats.pending > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setView('review')}>
                      处理
                    </Button>
                  )
                }
              />
              {pending.length === 0 ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-[12px] text-faint">
                  <Icon name="check" size={14} className="text-success" />
                  没有需要判断的内容
                </div>
              ) : (
                <div className="flex flex-col -mx-2">
                  {pending.slice(0, 4).map((memory: StoredMemory) => (
                    <button
                      key={memory.id}
                      type="button"
                      onClick={() => setView('review')}
                      className="flex items-center gap-2 px-2 h-[30px] rounded-[7px] hover:bg-hover text-left transition-colors"
                    >
                      <KindDot color={kindColor(memory.kind)} />
                      <Truncate className="text-[12px] flex-1">{memory.title}</Truncate>
                      <Icon name="chevron" size={12} className="text-faint shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* ── agent 接入状态 ── */}
            <section className="flex flex-col gap-1.5">
              <SectionHeader
                title="Agent 接入"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => useApp.getState().openSettings(true)}
                  >
                    管理
                  </Button>
                }
              />
              <div className="flex flex-col -mx-2">
                {agents.map((agent) => (
                  <button
                    key={agent.agent}
                    type="button"
                    onClick={() => useApp.getState().openSettings(true)}
                    className={cn(
                      'flex items-center gap-2.5 px-2 h-[30px] rounded-[7px] text-left',
                      'hover:bg-hover transition-colors duration-100',
                    )}
                  >
                    {/* 品牌标识与设置页保持一致；灰掉表示本机没装 */}
                    <AgentIcon
                      agent={agent.agent}
                      size={15}
                      className={cn('shrink-0', agent.available ? 'text-muted' : 'text-faint')}
                    />
                    <Truncate
                      className={cn('text-[12px] flex-1', !agent.available && 'text-muted')}
                    >
                      {agentName(agent.agent)}
                    </Truncate>
                    {agent.installed ? (
                      <Badge tone="success">{agent.skillInstalled ? 'MCP + Skill' : 'MCP'}</Badge>
                    ) : (
                      <span className="text-[10.5px] text-faint shrink-0">
                        {agent.available ? '已安装，未接入' : '未检测到'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* ── 活跃度热力图 ── */}
        <section className="flex flex-col gap-2 min-w-0">
          <SectionHeader title="活跃度" />
          <ActivityHeatmap days={activity} />
        </section>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string
  value: number
  note: string
  tone?: 'warning'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-0.5 px-3.5 py-3 bg-surface text-left',
        'hover:bg-hover transition-colors duration-150',
      )}
    >
      <span className="text-[11px] text-faint">{label}</span>
      <span
        className={cn(
          'text-[21px] font-semibold leading-tight tabular',
          tone === 'warning' && value > 0 ? 'text-warning' : 'text-text',
        )}
      >
        {formatNumber(value)}
      </span>
      <span className="text-[10.5px] text-faint truncate">{note}</span>
    </button>
  )
}
