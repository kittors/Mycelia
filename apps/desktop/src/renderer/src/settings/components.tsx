import type { ReactNode } from 'react'
import { cn } from '../shared/lib/cn.js'
import { Icon } from '../shared/ui/index.js'
import { type SaveState, useApp } from '../store/app-store.js'

/** 设置面板里的一个分区：小标题 + 可选说明 + 内容 */
export function PaneSection({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[12px] font-medium text-muted">{title}</h2>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

/** 段落级说明。放在分区之前，解释这一组配置是干什么的 */
export function PaneIntro({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] text-faint leading-relaxed mb-4">{children}</p>
}

/**
 * 保存状态指示。
 *
 * 设置是实时生效的，所以这里不是按钮而是反馈 —— 用户需要知道
 * 「刚才那下算数了」，但不需要为此做任何操作。
 * 写完停留一会儿就淡出，长期挂着反而变成噪音。
 */
export function SaveIndicator() {
  const state: SaveState = useApp((s) => s.configSave)
  if (state === 'idle') return null

  const text = state === 'saving' ? '保存中…' : state === 'saved' ? '已保存' : '保存失败'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11.5px] animate-fade-in',
        state === 'error' ? 'text-danger' : 'text-faint',
      )}
      role="status"
    >
      {state === 'saved' && <Icon name="check" size={12} className="text-success" />}
      {text}
    </span>
  )
}
