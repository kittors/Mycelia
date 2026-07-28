import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'

/**
 * 滑块。
 *
 * 自己实现而不是用原生 `<input type="range">`：原生滑轨与滑块的绘制由
 * 操作系统负责，`accent-color` 只能改一个颜色，尺寸、圆角、悬停反馈
 * 全都改不动，在这套克制的界面里显得又粗又突兀。
 *
 * 交互上有两条与原生不同的地方，都是刻意的：
 *
 *   1. 拖动过程中持续回调（onChange），松手时再发一次终值（onCommit）。
 *      调这个滑块通常伴随重排整张图，每一个中间值都触发重排会卡；
 *      但完全不给中间反馈又会让人不知道自己拖到了哪。所以轻的反馈
 *      跟着拖，重的动作等松手。
 *   2. 键盘左右可调，Home/End 到两端 —— 原生有，自己实现就得补回来。
 */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  disabled,
  className,
  label,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  /** 松手/键盘操作结束时触发。不传则等同于 onChange */
  onCommit?: (value: number) => void
  disabled?: boolean
  className?: string
  label?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const span = Math.max(1e-6, max - min)
  const percent = Math.min(100, Math.max(0, ((value - min) / span) * 100))

  const valueAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return value
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)))
      const raw = min + ratio * span
      return Math.min(max, Math.max(min, Math.round(raw / step) * step))
    },
    [min, max, span, step, value],
  )

  // 拖拽期间监听整个窗口：指针滑出滑轨甚至滑出窗口都要继续跟随，
  // 只挂在元素上的话鼠标一快就「脱手」了
  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent) => onChange(valueAt(event.clientX))
    const onUp = (event: PointerEvent) => {
      setDragging(false)
      ;(onCommit ?? onChange)(valueAt(event.clientX))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, valueAt, onChange, onCommit])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const commit = onCommit ?? onChange
    const next = (delta: number) => Math.min(max, Math.max(min, value + delta))
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        event.preventDefault()
        commit(next(-step))
        break
      case 'ArrowRight':
      case 'ArrowUp':
        event.preventDefault()
        commit(next(step))
        break
      case 'Home':
        event.preventDefault()
        commit(min)
        break
      case 'End':
        event.preventDefault()
        commit(max)
        break
    }
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={label}
      aria-disabled={disabled}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(true)
        onChange(valueAt(event.clientX))
      }}
      className={cn(
        'relative flex items-center h-4 select-none touch-none',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <div className="absolute inset-x-0 h-[3px] rounded-full bg-border" />
      <div
        className="absolute left-0 h-[3px] rounded-full bg-accent transition-[width] duration-75"
        style={{ width: `${percent}%` }}
      />
      <div
        className={cn(
          'absolute w-3 h-3 rounded-full bg-accent shadow-sm -translate-x-1/2',
          'transition-transform duration-100',
          // 按住时略微放大：拖动中缺少这点反馈会让人不确定自己有没有抓住它
          dragging ? 'scale-125' : 'hover:scale-110',
        )}
        style={{ left: `${percent}%` }}
      />
    </div>
  )
}
