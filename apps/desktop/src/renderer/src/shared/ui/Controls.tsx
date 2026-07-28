import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'

/** 轨道与滑块的尺寸。滑块位移 = 轨道宽 - 滑块直径 - 两侧内边距 */
const TRACK_WIDTH = 32
const TRACK_HEIGHT = 19
const THUMB_SIZE = 15
const THUMB_INSET = 2
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - THUMB_INSET * 2

/**
 * 开关。
 *
 * 滑块用 flex 定位而不是 absolute + translate：
 * absolute 元素只写 top 不写 left 时，水平位置取「静态位置」，
 * 而 button 默认 text-align:center 会让这个静态位置落在正中间 ——
 * 于是关闭态的滑块出现在右边，开启态直接冲出轨道。
 * 这个坑很隐蔽，改用 flex 从根上避开：滑块是流内元素，位移只靠 transform。
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{ width: TRACK_WIDTH, height: TRACK_HEIGHT, padding: THUMB_INSET }}
      className={cn(
        'inline-flex items-center shrink-0 rounded-full',
        'transition-colors duration-200',
        'disabled:opacity-40 disabled:pointer-events-none',
        // 关闭态的轨道要足够亮：太暗的话深色主题下滑块（canvas 色）会整个融进去
        checked ? 'bg-accent' : 'bg-faint/60',
      )}
    >
      <span
        aria-hidden="true"
        style={{
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          transform: `translateX(${checked ? THUMB_TRAVEL : 0}px)`,
        }}
        className={cn(
          // 滑块用 canvas 色，与开启态的 accent 轨道天然反色；
          // ring 给它一圈描边，关闭态在灰轨道上也能看清边界
          'rounded-full bg-canvas shadow-sm ring-1 ring-black/[0.06]',
          'transition-transform duration-200 ease-[var(--ease-out)]',
        )}
      />
    </button>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

/**
 * 分段控件。
 *
 * 滑块的位置和宽度是**实测**出来的，不是按「容器宽 ÷ 选项数」算的。
 *
 * 算的那版有个隐蔽的错：flex item 默认 `min-width: auto`，
 * 所以 `flex-1` 并不能让选项真正等宽 ——「跟随系统」比「浅色」宽，
 * 而滑块仍按等宽画，于是它盖到了下一个选项上。
 *
 * 实测还顺带解决了字体加载完成后文字宽度变化、以及窗口缩放这两种情况。
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (next: T) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  // useLayoutEffect 而不是 useEffect：要在浏览器绘制前定好位置，
  // 否则首帧会看到滑块从左上角闪一下再跳到正确位置
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const active = container.querySelector<HTMLElement>(`[data-segment="${value}"]`)
      if (!active) return
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
    }

    measure()

    // 容器尺寸变化时重测。字体加载、窗口缩放都会走到这里
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [value])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative inline-flex items-center p-[2px] gap-[2px]',
        'bg-sunken border border-border rounded-[8px]',
        className,
      )}
    >
      {indicator && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-[2px] bottom-[2px] rounded-[6px] bg-raised shadow-sm',
            'transition-[transform,width] duration-200 ease-[var(--ease-out)]',
          )}
          style={{
            left: 0,
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
          }}
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-segment={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          className={cn(
            'relative z-10 inline-flex items-center justify-center gap-1.5',
            'h-[26px] px-3 text-[12px] font-medium rounded-[6px] whitespace-nowrap',
            'transition-colors duration-150',
            option.value === value ? 'text-text' : 'text-muted hover:text-text',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** 筹码式筛选器。用于记忆类型这类多值、可滚动的筛选 */
export function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 h-[25px] px-2.5 shrink-0',
        'text-[12px] rounded-full border whitespace-nowrap',
        'transition-[background-color,border-color,color] duration-150',
        active
          ? 'bg-selected border-border-strong text-text'
          : 'bg-transparent border-border text-muted hover:text-text hover:bg-hover',
      )}
    >
      {color && <span className="size-[6px] rounded-full shrink-0" style={{ background: color }} />}
      {children}
    </button>
  )
}
