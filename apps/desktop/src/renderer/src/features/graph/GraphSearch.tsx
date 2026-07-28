import { useEffect, useRef, useState } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { KIND_LABELS, kindColor } from '../../shared/lib/labels.js'
import { Icon, Input, KindDot } from '../../shared/ui/index.js'

export interface GraphSearchHit {
  id: string
  label: string
  kind: string
  /** 命中的节点不在当前渲染的子图里，选它需要重新以它为中心取图 */
  offView?: boolean
}

/**
 * 图内搜索。
 *
 * 节点一多，「找到那一个」就不再是靠眼睛扫的事 —— 上万个点的画面里
 * 肉眼定位一个标题是不可能的，搜索是这个规模下唯一可用的导航方式。
 *
 * 输入即高亮（其余节点淡出），上下键走候选，回车定位。不做防抖：
 * 匹配是内存里的一次线性扫描，比一次 setState 还便宜。
 */
export function GraphSearch({
  onSearch,
  onPick,
  onClear,
}: {
  onSearch: (text: string) => Promise<GraphSearchHit[]>
  onPick: (id: string) => void
  onClear: () => void
}) {
  const [text, setText] = useState('')
  const [hits, setHits] = useState<GraphSearchHit[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!text.trim()) {
      setHits([])
      setOpen(false)
      onClear()
      return
    }
    // 搜索要查全库，是异步的；用 alive 挡住过期响应，
    // 否则打字快的时候先发的请求后回来，候选会跳回旧结果
    let alive = true
    void onSearch(text).then((found) => {
      if (!alive) return
      setHits(found)
      setActive(0)
      setOpen(true)
    })
    return () => {
      alive = false
    }
  }, [text, onSearch, onClear])

  const pick = (index: number) => {
    const hit = hits[index]
    if (!hit) return
    onPick(hit.id)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (current + 1) % Math.max(1, hits.length))
      setOpen(true)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (current - 1 + hits.length) % Math.max(1, hits.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (text) setText('')
      else inputRef.current?.blur()
    }
  }

  return (
    <div className="relative w-[220px]">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: 内部就是 Input 渲染出的 input */}
      <label className="relative block">
        <Icon
          name="search"
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
        />
        <Input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder="搜索节点"
          className="pl-7.5 pr-7 h-8 text-[12.5px]"
        />
        {text && (
          <button
            type="button"
            aria-label="清空"
            onClick={() => setText('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-faint hover:text-text hover:bg-hover"
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </label>

      {open && hits.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-30 p-1 max-h-[280px] overflow-y-auto bg-overlay border border-border rounded-[9px] shadow-lg animate-overlay-in">
          {hits.map((hit, index) => (
            <button
              key={hit.id}
              type="button"
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(index)}
              className={cn(
                'flex items-center gap-2 w-full px-2 h-[28px] rounded-[6px] text-left cursor-pointer',
                index === active ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              <KindDot color={kindColor(hit.kind)} />
              <span className="flex-1 min-w-0 truncate text-[12.5px]">{hit.label}</span>
              {/* 视图外的节点要说明白，否则用户点了会看到整张图重新排布，不知道发生了什么 */}
              {hit.offView && (
                <span className="shrink-0 text-[10px] text-faint px-1 rounded bg-hover">
                  视图外
                </span>
              )}
              <span className="shrink-0 text-[10.5px] text-faint">
                {KIND_LABELS[hit.kind] ?? hit.kind}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && text.trim() && hits.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-30 px-2.5 py-2 text-[11.5px] text-faint bg-overlay border border-border rounded-[9px] shadow-lg animate-overlay-in">
          没有匹配的节点
        </div>
      )}
    </div>
  )
}
