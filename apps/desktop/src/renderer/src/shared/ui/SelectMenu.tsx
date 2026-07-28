import type { CSSProperties, Ref } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn.js'
import { Icon } from './Icon.js'
import { MAX_MENU_HEIGHT, type MenuRect, type SelectOption } from './select-types.js'

/**
 * 下拉的选项列表。
 *
 * 渲染进 portal —— 挂在原地会被祖先的 `overflow: hidden` 裁掉，
 * 而下拉框基本都待在滚动容器里。
 */
export function SelectMenu<T extends string>({
  id,
  rect,
  options,
  value,
  active,
  exiting,
  menuRef,
  onActivate,
  onCommit,
}: {
  id: string
  rect: MenuRect
  options: ReadonlyArray<SelectOption<T>>
  value: T
  active: number
  exiting: boolean
  menuRef: Ref<HTMLDivElement>
  onActivate: (index: number) => void
  onCommit: (index: number) => void
}) {
  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="listbox"
      style={
        {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          maxHeight: MAX_MENU_HEIGHT,
          transformOrigin: rect.side === 'up' ? 'bottom center' : 'top center',
          // 向下展开从上边长出，向上展开从下边长出
          '--pop-offset': rect.side === 'up' ? '4px' : '-4px',
        } as CSSProperties
      }
      className={cn(
        'fixed z-[90] overflow-y-auto p-1',
        'bg-overlay border border-border rounded-[9px] shadow-lg',
        exiting ? 'animate-overlay-out' : 'animate-overlay-in',
      )}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          data-active={index === active || undefined}
          disabled={option.disabled}
          onMouseEnter={() => onActivate(index)}
          onClick={() => onCommit(index)}
          className={cn(
            'flex items-center gap-2 w-full h-[28px] px-2 rounded-[6px] cursor-pointer',
            'text-[12.5px] text-left transition-colors duration-100',
            'disabled:opacity-40 disabled:pointer-events-none',
            index === active ? 'bg-selected' : 'hover:bg-hover',
          )}
        >
          <span className="flex-1 min-w-0 truncate">{option.label}</span>
          {option.hint && <span className="text-[10.5px] text-faint shrink-0">{option.hint}</span>}
          {option.value === value && <Icon name="check" size={12} className="shrink-0 text-text" />}
        </button>
      ))}
    </div>,
    document.body,
  )
}
