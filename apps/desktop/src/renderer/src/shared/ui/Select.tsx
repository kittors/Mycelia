import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { usePresence } from '../hooks/usePresence.js'
import { cn } from '../lib/cn.js'
import { Icon } from './Icon.js'
import { SelectMenu } from './SelectMenu.js'
import {
  EXIT_DURATION,
  MAX_MENU_HEIGHT,
  MENU_MARGIN,
  type MenuRect,
  type SelectOption,
} from './select-types.js'

/**
 * 下拉选择。
 *
 * 自己实现而不是用原生 `<select>`：原生的选项列表由**操作系统**绘制，
 * 字体、圆角、配色全都不受我们控制，在这套克制的中性风格里显得格格不入，
 * 深色主题下尤其突兀（macOS 会画出亮色的系统菜单）。
 *
 * 菜单渲染进 portal —— 挂在原地会被祖先的 `overflow: hidden` 裁掉，
 * 而下拉框基本都待在滚动容器里。
 *
 * 键盘可以走完全程：上下移动、回车确认、Esc 取消、Home/End 跳首尾。
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled,
  className,
  id,
}: {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (next: T) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}) {
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<MenuRect | null>(null)
  const { mounted, exiting } = usePresence(open, EXIT_DURATION)

  const selected = options.find((option) => option.value === value)

  const close = useCallback((focusTrigger = true) => {
    setOpen(false)
    // 不清 rect —— 退场动画还要用它定位，清了菜单会先跳回左上角再消失
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    const anchor = triggerRef.current?.getBoundingClientRect()
    if (!anchor) return
    setRect({ left: anchor.left, top: anchor.bottom + 4, width: anchor.width, side: 'down' })
    // 打开时把高亮落在当前选中项上，而不是永远从第一项开始
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    )
    setOpen(true)
  }, [disabled, options, value])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) return
      onChange(option.value)
      close()
    },
    [options, onChange, close],
  )

  /**
   * 上下翻不能停在禁用项上 —— 停在一个按回车没反应的选项上，
   * 用户只会以为键盘导航坏了。
   */
  const step = useCallback(
    (delta: number) => {
      setActive((current) => {
        let next = current
        for (let i = 0; i < options.length; i++) {
          next = (next + delta + options.length) % options.length
          if (!options[next]?.disabled) return next
        }
        return current
      })
    },
    [options],
  )

  /**
   * 菜单放不下就翻到触发器上方。
   *
   * 翻转结果写回 state 而不是直接改 DOM style —— 展开方向同时决定了
   * 缩放动画的原点（向下弹的菜单该从顶边长出，向上弹的从底边长出），
   * 偷改 style 会让动画和实际位置对不上。
   *
   * 依赖里必须有 mounted：菜单要等 usePresence 把 mounted 置真之后才挂载，
   * 而那发生在 useEffect 里，比这个 useLayoutEffect 晚一轮。只依赖 open 的话，
   * 本 effect 跑的时候 menuRef 还是空的，直接 return，之后依赖不再变化 ——
   * 翻转永远等不到机会，长菜单就一路溢出到视口外面。
   */
  useLayoutEffect(() => {
    if (!open || !mounted || !rect || rect.side === 'up') return
    const menu = menuRef.current
    const anchor = triggerRef.current
    if (!menu || !anchor) return

    const anchorRect = anchor.getBoundingClientRect()
    const spaceBelow = window.innerHeight - anchorRect.bottom - MENU_MARGIN
    const height = Math.min(menu.scrollHeight, MAX_MENU_HEIGHT)

    if (spaceBelow < height && anchorRect.top > spaceBelow) {
      setRect((current) =>
        current
          ? { ...current, top: Math.max(MENU_MARGIN, anchorRect.top - height - 4), side: 'up' }
          : current,
      )
    }
  }, [open, mounted, rect])

  // 高亮项滚进视野。active 不在 effect 体内出现，但它正是要响应的变化
  // biome-ignore lint/correctness/useExhaustiveDependencies: active 变化即是重跑的理由
  useLayoutEffect(() => {
    if (!open || !mounted) return
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, mounted, active])

  // 点外面、滚动、改窗口大小都收起
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close(false)
    }
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      close(false)
    }
    const onResize = () => close(false)
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        step(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        step(-1)
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(options.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(active)
        break
      case 'Escape':
        event.preventDefault()
        close()
        break
      case 'Tab':
        close(false)
        break
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex items-center gap-2 w-full h-8 px-2.5 rounded-[7px]',
          'bg-raised text-text border border-border text-[13px] text-left',
          'transition-[border-color,box-shadow,background-color] duration-150',
          'hover:border-border-strong cursor-pointer',
          'disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed',
          open && 'border-accent',
          className,
        )}
      >
        <span className={cn('flex-1 min-w-0 truncate', !selected && 'text-faint')}>
          {selected?.label ?? placeholder}
        </span>
        <Icon
          name="chevron-down"
          size={13}
          className={cn(
            'shrink-0 text-faint transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {mounted && rect && (
        <SelectMenu
          id={listId}
          rect={rect}
          options={options}
          value={value}
          active={active}
          exiting={exiting}
          menuRef={menuRef}
          onActivate={setActive}
          onCommit={commit}
        />
      )}
    </>
  )
}
