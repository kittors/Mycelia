import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '../lib/cn.js'
import { IconButton } from './Button.js'
import { Icon } from './Icon.js'

/**
 * 遮罩层。
 *
 * 只在 mousedown 落在自己身上时关闭 —— 用 click 的话，
 * 在内容区按下鼠标、拖到遮罩上松开也会触发关闭，选中文字时经常误关。
 */
function Backdrop({
  onClose,
  children,
  align,
}: {
  onClose: () => void
  children: ReactNode
  align: 'center' | 'right' | 'top'
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const alignment = {
    center: 'items-center justify-center',
    right: 'items-stretch justify-end',
    top: 'items-start justify-center pt-[14vh]',
  }[align]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc 已绑定，这里是鼠标的等价出口
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-black/35 animate-fade-in',
        'backdrop-blur-[1px]',
        alignment,
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )
}

export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  return (
    <Backdrop onClose={onClose} align="center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        className={cn(
          'flex flex-col max-h-[82vh] bg-overlay border border-border',
          'rounded-[12px] shadow-lg animate-pop overflow-hidden',
        )}
      >
        <header className="flex items-start justify-between gap-4 px-4 pt-3.5 pb-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-[14px] font-semibold text-text">{title}</h2>
            {description && <p className="text-[12px] text-faint leading-snug">{description}</p>}
          </div>
          <IconButton label="关闭" size="sm" onClick={onClose}>
            <Icon name="x" size={14} />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-surface">
            {footer}
          </footer>
        )}
      </div>
    </Backdrop>
  )
}

/** 右侧抽屉。用于「写记忆」这类需要大输入区、又不该打断上下文的操作 */
export function Drawer({
  title,
  description,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  return (
    <Backdrop onClose={onClose} align="right">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        className={cn(
          'flex flex-col h-full bg-overlay border-l border-border',
          'shadow-lg animate-slide-in',
        )}
      >
        <header className="flex items-start justify-between gap-4 px-4 h-[52px] shrink-0 border-b border-border">
          <div className="flex flex-col justify-center h-full min-w-0">
            <h2 className="text-[14px] font-semibold text-text leading-tight">{title}</h2>
            {description && <p className="text-[11.5px] text-faint leading-snug">{description}</p>}
          </div>
          <IconButton label="关闭" size="sm" className="mt-2.5" onClick={onClose}>
            <Icon name="x" size={14} />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
            {footer}
          </footer>
        )}
      </aside>
    </Backdrop>
  )
}

/** 命令面板等需要贴顶显示的浮层 */
export function TopSheet({
  onClose,
  children,
  label,
  width = 560,
}: {
  onClose: () => void
  children: ReactNode
  label: string
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <Backdrop onClose={onClose} align="top">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ width }}
        className={cn(
          'flex flex-col max-h-[62vh] bg-overlay border border-border',
          'rounded-[12px] shadow-lg animate-pop overflow-hidden',
        )}
      >
        {children}
      </div>
    </Backdrop>
  )
}
