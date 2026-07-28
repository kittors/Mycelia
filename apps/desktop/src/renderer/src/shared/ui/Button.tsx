import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../lib/cn.js'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  // 强调按钮用反色而不是品牌色 —— 深色主题下是白底黑字，浅色下反过来
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:scale-[0.985]',
  secondary: 'bg-raised text-text border border-border hover:bg-hover active:bg-active',
  ghost: 'text-muted hover:text-text hover:bg-hover active:bg-active',
  // 文字型：用在菜单项这类「一排选项里有一个是危险的」场合
  danger: 'text-danger hover:bg-danger/10 active:bg-danger/15',
  // 实心：用在确认框里那个真正执行破坏的按钮，它得有主操作的分量
  'danger-solid': 'bg-danger text-white hover:brightness-110 active:scale-[0.985]',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-[6px]',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-[7px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-[background-color,color,transform,opacity] duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 图标按钮没有可见文字，label 既作 aria-label 也作 tooltip */
  label: string
  size?: Size
  active?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  label,
  size = 'md',
  active,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center justify-center rounded-[7px] shrink-0',
        'transition-[background-color,color] duration-150',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-7' : 'size-8',
        active ? 'bg-selected text-text' : 'text-muted hover:text-text hover:bg-hover',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
