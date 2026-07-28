import { useEffect } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { Icon } from '../../shared/ui/index.js'
import { type Toast, useApp } from '../../store/app-store.js'

const TONES: Record<Toast['tone'], { className: string; icon: 'check' | 'alert' | 'info' }> = {
  info: { className: 'text-muted', icon: 'info' },
  success: { className: 'text-success', icon: 'check' },
  danger: { className: 'text-danger', icon: 'alert' },
}

export function Toaster() {
  const toasts = useApp((s) => s.toasts)

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col-reverse gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useApp((s) => s.dismissToast)

  // 错误留久一点 —— 用户需要时间读完才能决定怎么办
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.tone === 'danger' ? 6000 : 3200)
    return () => clearTimeout(timer)
  }, [toast.id, toast.tone, dismiss])

  const tone = TONES[toast.tone]

  return (
    <button
      type="button"
      onClick={() => dismiss(toast.id)}
      className={cn(
        'pointer-events-auto flex items-start gap-2 max-w-[340px]',
        'px-3 py-2.5 rounded-[9px] bg-overlay border border-border shadow-md',
        'text-left animate-rise hover:border-border-strong transition-colors',
      )}
    >
      <Icon name={tone.icon} size={14} className={cn('mt-[1px] shrink-0', tone.className)} />
      <span className="text-[12.5px] leading-snug text-text" data-selectable>
        {toast.message}
      </span>
    </button>
  )
}
