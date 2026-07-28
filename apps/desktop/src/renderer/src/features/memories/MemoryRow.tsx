import type { StoredMemory } from '@mycelia/store'
import { memo } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { relativeTime } from '../../shared/lib/format.js'
import { agentName, KIND_LABELS, kindColor } from '../../shared/lib/labels.js'
import { Icon, KindDot, Truncate } from '../../shared/ui/index.js'

/**
 * 记忆行。
 *
 * memo 是必要的而不是保险：记忆库可能有几千条，
 * 父组件每次筛选变化都重渲染的话，列表会明显卡顿。
 */
export const MemoryRow = memo(function MemoryRow({
  memory,
  selected,
  onSelect,
  index = 0,
}: {
  memory: StoredMemory
  selected?: boolean
  onSelect: (id: string) => void
  index?: number
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(memory.id)}
      aria-current={selected}
      className={cn(
        'group flex items-start gap-2.5 w-full px-3 py-2 text-left rounded-[7px]',
        'transition-colors duration-100 stagger',
        selected ? 'bg-selected' : 'hover:bg-hover',
      )}
      // 只给前若干行做入场错峰，再多就变成等待了
      style={{ animationDelay: `${Math.min(index, 12) * 14}ms` }}
    >
      <span className="flex items-center h-[18px] shrink-0">
        <KindDot color={kindColor(memory.kind)} />
      </span>

      <span className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <Truncate className="text-[13px] leading-[18px]">{memory.title}</Truncate>
          {memory.pinned && <Icon name="pin" size={11} className="text-faint shrink-0" />}
          {memory.sensitivity === 'secret' && (
            <Icon name="lock" size={11} className="text-faint shrink-0" />
          )}
          {memory.status === 'pending' && (
            <span className="text-[10px] text-warning shrink-0">待确认</span>
          )}
        </span>

        <Truncate className="text-[11.5px] text-faint leading-snug">
          {memory.summary || memory.content.slice(0, 120)}
        </Truncate>
      </span>

      <span className="flex items-center gap-2.5 shrink-0 text-[11px] text-faint">
        <span className="hidden group-hover:inline">{KIND_LABELS[memory.kind]}</span>
        <span className="max-w-[110px] truncate">
          {memory.origin.project ?? agentName(memory.origin.agent)}
        </span>
        <span className="tabular w-[52px] text-right">{relativeTime(memory.updatedAt)}</span>
      </span>
    </button>
  )
})
