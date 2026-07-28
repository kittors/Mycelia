import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../lib/cn.js'

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
}) {
  const tones = {
    neutral: 'bg-hover text-muted',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/12 text-warning',
    danger: 'bg-danger/12 text-danger',
    info: 'bg-info/12 text-info',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-[19px] px-1.5 rounded-full',
        'text-[11px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** 记忆类型的色点。图谱、列表、详情三处共用同一套色，保持可识别 */
export function KindDot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span
      className="rounded-full shrink-0"
      style={{ width: size, height: size, background: color }}
    />
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin-slow', className)}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.6" />
      <path
        d="M12.5 7A5.5 5.5 0 0 0 7 1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('skeleton', className)} style={style} />
}

/**
 * 行式骨架。
 *
 * 骨架的价值在于「预告即将出现什么」，所以它得长得像真实内容 ——
 * 一整条 52px 的灰块什么也没告诉用户，还会在内容出现时造成明显的形变跳动。
 * 这里按「图标 + 文字 + 尾部控件」的通用行结构占位，宽度略作变化避免过于呆板。
 */
export function SkeletonRow({
  index = 0,
  avatar = true,
  trailing,
  className,
}: {
  index?: number
  /** 行首是否有图标位 */
  avatar?: boolean
  /** 行尾控件的形状，比如开关或按钮 */
  trailing?: 'switch' | 'text' | 'none'
  className?: string
}) {
  // 让每行的文字宽度不同，一排等长灰条看起来很假
  const widths = [136, 104, 152, 118, 128]
  const width = widths[index % widths.length]

  return (
    <div className={cn('flex items-center gap-2.5 px-3 h-[52px]', className)}>
      {avatar && <Skeleton className="size-[18px] rounded-full shrink-0" />}
      <Skeleton className="h-[9px] rounded-full" style={{ width }} />
      <div className="flex-1" />
      {trailing === 'switch' && <Skeleton className="h-[19px] w-8 rounded-full shrink-0" />}
      {trailing === 'text' && <Skeleton className="h-[9px] w-12 rounded-full shrink-0" />}
    </div>
  )
}

/** 段落式骨架，用于正文预览 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
          key={index}
          className="h-[9px] rounded-full"
          // 末行短一截，模仿真实段落的收尾
          style={{ width: index === lines - 1 ? '58%' : `${82 + ((index * 13) % 16)}%` }}
        />
      ))}
    </div>
  )
}

/**
 * 空状态。
 *
 * 每个空状态都要回答「为什么是空的」和「我该做什么」。
 * 只写一句「暂无数据」等于把用户丢在原地。
 */
export function Empty({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center px-6 py-14',
        'animate-fade-in',
        className,
      )}
    >
      {icon && <div className="text-faint mb-1">{icon}</div>}
      <h3 className="text-[13.5px] font-medium text-text">{title}</h3>
      {description && (
        <p className="text-[12.5px] text-faint max-w-[320px] leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** 分区标题。视图内的层级靠它和留白表达，不用卡片边框 */
export function SectionHeader({
  title,
  count,
  action,
  className,
}: {
  title: string
  count?: number
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 h-7', className)}>
      <div className="flex items-center gap-2">
        <h2 className="text-[12px] font-medium text-muted tracking-wide">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[11px] text-faint tabular">{count}</span>
        )}
      </div>
      {action}
    </div>
  )
}
