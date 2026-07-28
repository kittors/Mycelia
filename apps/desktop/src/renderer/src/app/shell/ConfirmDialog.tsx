import { useEffect, useRef } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { Button } from '../../shared/ui/index.js'
import { useConfirmStore } from '../../store/confirm.js'

/**
 * 确认框的宿主，挂在应用顶层，由 `confirm()` 唤起。
 *
 * 键盘上给了两个出口：Esc 取消，回车确认。破坏性操作时焦点落在取消键上 ——
 * 弹窗常常是在连续操作中途蹦出来的，那一刻手指往往已经在回车上了。
 */
export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending)
  const answer = useConfirmStore((s) => s.answer)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pending) return
    const target = pending.danger ? cancelRef : confirmRef
    target.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        answer(false)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        answer(true)
      }
    }
    // 捕获阶段：底下的编辑器、搜索框都监听着这两个键，得先截住
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, answer])

  if (!pending) return null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc 已绑定，这里是鼠标的等价出口
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 backdrop-blur-[1px] animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) answer(false)
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title}
        className={cn(
          'w-[360px] p-4 bg-overlay border border-border',
          'rounded-[12px] shadow-lg animate-pop',
        )}
      >
        <h2 className="text-[13.5px] font-semibold text-text">{pending.title}</h2>
        {pending.body && (
          <p className="mt-1.5 text-[12px] text-muted leading-relaxed">{pending.body}</p>
        )}

        <div className="flex items-center justify-end gap-2 mt-4">
          <Button ref={cancelRef} size="sm" variant="secondary" onClick={() => answer(false)}>
            {pending.cancelText ?? '取消'}
          </Button>
          <Button
            ref={confirmRef}
            size="sm"
            variant={pending.danger ? 'danger-solid' : 'primary'}
            onClick={() => answer(true)}
          >
            {pending.confirmText ?? '确定'}
          </Button>
        </div>
      </div>
    </div>
  )
}
