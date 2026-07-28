import { useEffect, useRef, useState } from 'react'
import type { MemoryDetail } from '../../../../shared/ipc-contract.js'
import { usePresence } from '../../shared/hooks/usePresence.js'
import { cn } from '../../shared/lib/cn.js'
import { formatDateTime, formatPercent } from '../../shared/lib/format.js'
import {
  agentName,
  CAPTURE_LABELS,
  EDGE_LABELS,
  KIND_LABELS,
  kindColor,
  SENSITIVITY_LABELS,
} from '../../shared/lib/labels.js'
import { Badge, Button, Icon, IconButton, KindDot, Tooltip } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

/**
 * 记忆详情。
 *
 * 内嵌在视图右侧而不是弹模态框 —— 用户需要一边看详情一边在左侧列表里
 * 继续浏览，模态框会切断这个动作。
 *
 * detail 传 null 表示关闭。组件常驻挂载、自己控制进出：如果由父组件用
 * `{detail && <MemoryInspector/>}` 决定挂载，关闭时元素会被瞬间拔掉，
 * 退场动画根本没机会播 —— 面板就那么「啪」地消失。
 */
export function MemoryInspector({
  detail,
  onClose,
  onOpenMemory,
  floating = false,
}: {
  detail: MemoryDetail | null
  onClose: () => void
  onOpenMemory?: (id: string) => void
  /** 浮在内容之上而不是并排占位。图谱用这个模式，避免画布被挤窄触发重排 */
  floating?: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const app = useApp()
  const { mounted, exiting } = usePresence(Boolean(detail), 180)

  /**
   * 置顶的乐观状态。
   *
   * 光靠 bump 刷新是不够的：上游只重新拉了列表和图谱快照，detail 是
   * select 时单独取的一份，不会跟着变 —— 点了图钉半天不亮，就像没生效。
   * 这里先本地点亮，写失败再退回去。
   */
  const [pinnedDraft, setPinnedDraft] = useState<boolean | null>(null)
  const currentId = detail?.memory.id ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换记忆就丢草稿，currentId 变化正是重跑的理由
  useEffect(() => setPinnedDraft(null), [currentId])

  // 退场那 180ms 里 detail 已经是 null 了，得留住最后一份内容继续渲染，
  // 否则面板会先变成空白再滑走
  const lastDetail = useRef<MemoryDetail | null>(detail)
  if (detail) lastDetail.current = detail
  const shown = detail ?? lastDetail.current

  if (!mounted || !shown) return null
  const { memory } = shown
  const pinned = pinnedDraft ?? memory.pinned

  const remove = async () => {
    try {
      await window.mycelia.deleteMemory(memory.id)
      app.toast('已删除', 'success')
      onClose()
    } catch (error) {
      app.fail(error)
    }
  }

  /**
   * 置顶。
   *
   * 名字容易让人以为只是把它排到列表最前，其实主要作用在检索侧：
   * 置顶给召回得分加 0.25，比重要度满分的 0.2 还高一档，
   * 也就是说 agent 下次检索时这条会明显更容易浮上来。
   *
   * 改完必须 bump 让上游重新拉数据 —— 否则 memory.pinned 还是旧值，
   * 图钉不会点亮，用户只看到一句 toast，会以为这个按钮什么也没做。
   */
  const togglePin = async () => {
    const next = !pinned
    setPinnedDraft(next)
    try {
      await window.mycelia.updateMemory(memory.id, { pinned: next })
      app.toast(next ? '已置顶，agent 检索时会优先召回' : '已取消置顶', 'success')
      app.bump()
    } catch (error) {
      setPinnedDraft(null)
      app.fail(error)
    }
  }

  return (
    <aside
      className={cn(
        'flex flex-col w-[340px] shrink-0 border-l border-border bg-surface',
        floating && 'absolute inset-y-0 right-0 z-20 shadow-lg',
        exiting ? 'animate-slide-out' : 'animate-slide-in',
      )}
    >
      <header className="flex items-center justify-between gap-2 h-[42px] px-3 shrink-0 border-b border-border">
        <span className="flex items-center gap-2 text-[11.5px] text-muted min-w-0">
          <KindDot color={kindColor(memory.kind)} />
          <span className="truncate">{KIND_LABELS[memory.kind] ?? memory.kind}</span>
        </span>
        <div className="flex items-center gap-0.5">
          {/* 置顶和关闭挨着放容易被当成同一类操作，给两个都配上说明 */}
          <Tooltip
            content={pinned ? '取消置顶，恢复正常召回权重' : '置顶：agent 检索时优先召回这条'}
          >
            <IconButton
              label={pinned ? '取消置顶' : '置顶'}
              size="sm"
              onClick={togglePin}
              aria-pressed={pinned}
              className={cn(pinned && 'bg-selected')}
            >
              {/* key 跟着状态走：换 key 会重新挂载，动画才会重播 */}
              <Icon
                key={String(pinned)}
                name="pin"
                filled={pinned}
                size={13}
                className={cn('animate-pin-toggle', pinned ? 'text-accent' : 'text-faint')}
              />
            </IconButton>
          </Tooltip>
          <Tooltip content="关闭详情">
            <IconButton label="关闭" size="sm" onClick={onClose}>
              <Icon name="x" size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      {/*
        key 绑在记忆 id 上：切换节点时整块内容重新挂载，动画重播。
        不这么做的话文字是「原地替换」的，快速点几个节点就像文本在闪烁，
        分不清到底换没换。
      */}
      <div key={memory.id} className="flex-1 overflow-y-auto px-3.5 py-3.5 animate-fade-in">
        <h2 className="text-[14.5px] font-semibold leading-snug" data-selectable>
          {memory.title}
        </h2>

        {memory.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {memory.tags.map((tag) => (
              <Badge key={tag}>#{tag}</Badge>
            ))}
          </div>
        )}

        <div
          className={cn(
            'mt-3 text-[12.5px] leading-[1.7] whitespace-pre-wrap break-words',
            memory.locked ? 'text-faint italic' : 'text-text',
          )}
          data-selectable
        >
          {memory.locked
            ? '保险箱已锁定，正文不可读取。到「保险箱」解锁后再查看。'
            : memory.content}
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 mt-5 pt-4 border-t border-border">
          <Detail label="重要度" value={formatPercent(memory.importance)} />
          <Detail label="置信度" value={formatPercent(memory.confidence)} />
          <Detail label="敏感度" value={SENSITIVITY_LABELS[memory.sensitivity] ?? '—'} />
          <Detail label="来源" value={agentName(memory.origin.agent)} />
          <Detail label="写入方式" value={CAPTURE_LABELS[memory.captureMode] ?? '—'} />
          <Detail label="被召回" value={`${memory.recallCount} 次`} />
          <Detail label="创建" value={formatDateTime(memory.createdAt)} />
          <Detail label="更新" value={formatDateTime(memory.updatedAt)} />
        </dl>

        {shown.entities.length > 0 && (
          <section className="mt-5 pt-4 border-t border-border">
            <h3 className="text-[11px] font-medium text-muted mb-2">涉及实体</h3>
            <div className="flex flex-wrap gap-1">
              {shown.entities.map((entity) => (
                <Badge key={entity.id}>
                  {entity.name}
                  <span className="text-faint">{entity.mentionCount}</span>
                </Badge>
              ))}
            </div>
          </section>
        )}

        {shown.neighbors.length > 0 && (
          <section className="mt-5 pt-4 border-t border-border">
            <h3 className="text-[11px] font-medium text-muted mb-1.5">关联记忆</h3>
            <div className="flex flex-col -mx-1.5">
              {shown.neighbors.slice(0, 8).map((item) => (
                <button
                  key={item.memory.id}
                  type="button"
                  onClick={() => onOpenMemory?.(item.memory.id)}
                  disabled={!onOpenMemory}
                  className={cn(
                    'flex items-start gap-2 px-1.5 py-1.5 rounded-[6px] text-left',
                    'transition-colors duration-100',
                    onOpenMemory ? 'hover:bg-hover' : 'cursor-default',
                  )}
                >
                  <span className="flex items-center h-[16px] shrink-0">
                    <KindDot color={kindColor(item.memory.kind)} size={5} />
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-[12px] leading-[16px] truncate">{item.memory.title}</span>
                    <span className="text-[10.5px] text-faint">
                      {item.reason ?? EDGE_LABELS[item.kind] ?? item.kind}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-border shrink-0">
        {confirmDelete ? (
          <>
            <span className="text-[11.5px] text-muted">确认删除？</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                取消
              </Button>
              <Button size="sm" variant="danger" onClick={remove}>
                删除
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[10.5px] text-faint font-[var(--font-mono)] truncate">
              {memory.id}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Icon name="trash" size={13} />}
              onClick={() => setConfirmDelete(true)}
            >
              删除
            </Button>
          </>
        )}
      </footer>
    </aside>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="text-[10.5px] text-faint">{label}</dt>
      <dd className="text-[12px] truncate">{value}</dd>
    </div>
  )
}
