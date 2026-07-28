import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn.js'

const CONTROL = cn(
  'w-full bg-raised text-text border border-border rounded-[7px]',
  'placeholder:text-faint transition-[border-color,box-shadow] duration-150 ease-[var(--ease-out)]',
  'hover:border-border-strong',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border',
)

export function Input({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(CONTROL, 'h-8 px-2.5 text-[13px]', className)} {...rest} />
}

export function Textarea({
  className,
  ref,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, 'px-2.5 py-2 text-[13px] resize-none leading-relaxed', className)}
      {...rest}
    />
  )
}

/**
 * 表单行。
 *
 * hint 放在标签下方而不是输入框下方 —— 用户是先读说明再填写，
 * 说明出现在填写之后就等于没说。
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children 是 Input/Select/Textarea，包裹式关联成立，静态分析看不穿组件边界
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex flex-col gap-0.5">
        <span className="text-[12px] font-medium text-text">{label}</span>
        {hint && <span className="text-[11px] text-faint leading-snug">{hint}</span>}
      </span>
      {children}
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </label>
  )
}

/** 设置页用的横向行：左侧说明，右侧控件 */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] text-text">{label}</span>
        {hint && <span className="text-[11.5px] text-faint leading-snug">{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
