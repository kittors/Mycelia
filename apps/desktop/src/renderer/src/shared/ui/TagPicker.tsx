import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'
import { Icon } from './Icon.js'

/**
 * 标签选择。
 *
 * 改成候选列表而不是让人裸敲，是因为标签一旦靠手输，很快就会长出
 * `infra/ssh`、`infra-ssh`、`Infra/SSH` 这三个各自为政的东西 ——
 * 它们在检索和图谱里是三个不相干的标签，而用户以为是同一个。
 *
 * 已用过的排在前面（按使用频次），输入时实时过滤；输入的内容不在候选里
 * 也能直接建 —— 不能为了统一就堵死新标签，那会逼人把新东西硬塞进旧分类。
 */
export function TagPicker({
  value,
  onChange,
  placeholder = '输入或选择标签',
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [known, setKnown] = useState<Array<{ tag: string; count: number }>>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.mycelia
      .listTags()
      .then((tags) => setKnown(tags.map((t) => ({ tag: t.tag, count: t.count }))))
      .catch(() => setKnown([]))
  }, [])

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const chosen = new Set(value)
    return known
      .filter((item) => !chosen.has(item.tag))
      .filter((item) => !needle || item.tag.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [known, query, value])

  const trimmed = query.trim()
  // 输入的内容既不在候选里也没被选中时，允许新建
  const canCreate =
    trimmed.length > 0 &&
    !value.includes(trimmed) &&
    !candidates.some((item) => item.tag === trimmed)

  const add = (tag: string) => {
    const clean = tag.trim()
    if (!clean || value.includes(clean)) return
    onChange([...value, clean])
    setQuery('')
    setActive(0)
    inputRef.current?.focus()
  }

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  const options = canCreate ? [{ tag: trimmed, count: -1 }, ...candidates] : candidates

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % Math.max(1, options.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + options.length) % Math.max(1, options.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const picked = options[active]
      if (picked) add(picked.tag)
      else if (trimmed) add(trimmed)
    } else if (event.key === 'Backspace' && !query && value.length > 0) {
      // 空输入框按退格删掉最后一个标签，是这类控件的通用习惯
      remove(value[value.length - 1] as string)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  // 点外面收起
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={boxRef} className="relative">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 这层只是把点击转交给内部输入框，键盘操作由输入框自己处理 */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 min-h-8 px-1.5 py-1 rounded-[7px]',
          'bg-raised border border-border cursor-text',
          'transition-[border-color,box-shadow] duration-150',
          'focus-within:border-accent',
        )}
        onMouseDown={(event) => {
          // 点空白区聚焦输入框，但点标签上的删除按钮时别抢焦点
          if (event.target === event.currentTarget) inputRef.current?.focus()
        }}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-[5px] bg-sunken text-[11.5px]"
          >
            {tag}
            <button
              type="button"
              aria-label={`移除 ${tag}`}
              onClick={() => remove(tag)}
              className="p-0.5 rounded text-faint hover:text-text hover:bg-hover cursor-pointer"
            >
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[100px] h-[22px] bg-transparent text-[12.5px] outline-none placeholder:text-faint"
        />
      </div>

      {open && options.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-30 p-1 max-h-[220px] overflow-y-auto bg-overlay border border-border rounded-[9px] shadow-lg animate-overlay-in">
          {options.map((item, index) => (
            <button
              key={item.tag}
              type="button"
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // mousedown 而非 click：click 之前输入框已经失焦，列表会先收起来
                event.preventDefault()
                add(item.tag)
              }}
              className={cn(
                'flex items-center gap-2 w-full h-[28px] px-2 rounded-[6px] text-left cursor-pointer',
                'text-[12.5px] transition-colors duration-100',
                index === active ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              {item.count < 0 ? (
                <>
                  <Icon name="plus" size={11} className="text-faint shrink-0" />
                  <span className="flex-1 min-w-0 truncate">新建「{item.tag}」</span>
                </>
              ) : (
                <>
                  <Icon name="tag" size={11} className="text-faint shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{item.tag}</span>
                  <span className="text-[10.5px] text-faint tabular shrink-0">{item.count}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
