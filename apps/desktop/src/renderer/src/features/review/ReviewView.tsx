import type { StoredMemory } from '@mycelia/store'
import { useCallback, useEffect, useState } from 'react'
import { useAsync } from '../../shared/hooks/useAsync.js'
import { cn } from '../../shared/lib/cn.js'
import { formatPercent, relativeTime } from '../../shared/lib/format.js'
import { agentName, CAPTURE_LABELS, KIND_LABELS, kindColor } from '../../shared/lib/labels.js'
import { Badge, Button, Empty, Icon, KindDot } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

/**
 * 待确认队列。
 *
 * 这里的内容是准入把关拦下来的 —— 模型判断它缺乏长期价值，但没有直接丢弃。
 * 用户扫一眼就能把误杀的捞回来，所以速度是第一位的：
 * 全键盘操作，一条处理完自动进下一条。
 */
export function ReviewView() {
  const revision = useApp((s) => s.revision)
  const app = useApp()
  const [cursor, setCursor] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, reload } = useAsync(
    () =>
      window.mycelia.listMemories({
        status: ['pending'],
        limit: 100,
        orderBy: 'created',
      }),
    [revision],
  )

  const memories = data?.memories ?? []
  const active = memories[Math.min(cursor, memories.length - 1)]

  const act = useCallback(
    async (memory: StoredMemory, action: 'accept' | 'reject') => {
      setBusyId(memory.id)
      try {
        if (action === 'accept') {
          await window.mycelia.acceptMemory(memory.id)
          app.toast('已收进记忆库', 'success')
        } else {
          await window.mycelia.rejectMemory(memory.id)
          app.toast('已丢弃')
        }
        // 停在原位：下一条会自动补上来，用户不用重新找位置
        setCursor((index) => Math.max(0, Math.min(index, memories.length - 2)))
        reload()
        app.bump()
      } catch (error) {
        app.fail(error)
      } finally {
        setBusyId(null)
      }
    },
    [app, reload, memories.length],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || busyId) return
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        setCursor((index) => Math.min(index + 1, memories.length - 1))
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((index) => Math.max(index - 1, 0))
      } else if (event.key === 'a') {
        event.preventDefault()
        void act(active, 'accept')
      } else if (event.key === 'r') {
        event.preventDefault()
        void act(active, 'reject')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, busyId, memories.length, act])

  if (memories.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty
          icon={<Icon name="check" size={28} className="text-success" />}
          title="队列已清空"
          description="agent 写入的内容会先过一道价值把关。没通过的会停在这里等你确认，而不是被直接丢掉。"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 左侧队列 */}
      <div className="flex flex-col w-[260px] shrink-0 border-r border-border">
        <div className="flex items-center justify-between px-3 h-[38px] shrink-0">
          <span className="text-[11px] text-muted">{memories.length} 条待确认</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {memories.map((memory, index) => (
            <button
              key={memory.id}
              type="button"
              onClick={() => setCursor(index)}
              className={cn(
                'flex items-start gap-2 w-full px-2.5 py-2 rounded-[7px] text-left',
                'transition-colors duration-100',
                index === cursor ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              <span className="flex items-center h-[16px] shrink-0">
                <KindDot color={kindColor(memory.kind)} size={5} />
              </span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[12px] leading-[16px] line-clamp-2">{memory.title}</span>
                <span className="text-[10.5px] text-faint">
                  {agentName(memory.origin.agent)} · {relativeTime(memory.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧详情与决策 */}
      {active && (
        <div key={active.id} className="flex flex-col flex-1 min-w-0 animate-fade-in">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <div className="max-w-[620px]">
              <div className="flex items-center gap-2 mb-3">
                <Badge>
                  <KindDot color={kindColor(active.kind)} size={5} />
                  {KIND_LABELS[active.kind] ?? active.kind}
                </Badge>
                <Badge>{CAPTURE_LABELS[active.captureMode] ?? active.captureMode}</Badge>
                <span className="text-[11px] text-faint">
                  把关评分 {formatPercent(active.confidence)}
                </span>
              </div>

              <h2 className="text-[17px] font-semibold leading-snug" data-selectable>
                {active.title}
              </h2>

              <p
                className="mt-3 text-[13px] leading-[1.75] whitespace-pre-wrap break-words"
                data-selectable
              >
                {active.content}
              </p>

              {active.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-4">
                  {active.tags.map((tag) => (
                    <Badge key={tag}>#{tag}</Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border text-[11px] text-faint">
                <span>{agentName(active.origin.agent)}</span>
                {active.origin.project && <span>项目 {active.origin.project}</span>}
                <span>{relativeTime(active.createdAt)}</span>
              </div>
            </div>
          </div>

          <footer className="flex items-center gap-2 px-6 py-3 border-t border-border shrink-0">
            <Button
              variant="ghost"
              disabled={busyId !== null}
              icon={<Icon name="x" size={14} />}
              onClick={() => act(active, 'reject')}
            >
              丢弃
              <kbd className="ml-1 text-[10px] text-faint">R</kbd>
            </Button>
            <Button
              variant="primary"
              disabled={busyId !== null}
              icon={<Icon name="check" size={14} />}
              onClick={() => act(active, 'accept')}
            >
              收进记忆库
              <kbd className="ml-1 text-[10px] opacity-60">A</kbd>
            </Button>
            <div className="flex-1" />
            <span className="text-[10.5px] text-faint">J / K 切换</span>
          </footer>
        </div>
      )}
    </div>
  )
}
