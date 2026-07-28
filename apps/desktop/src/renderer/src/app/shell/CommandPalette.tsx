import type { DocumentHit } from '@mycelia/core'
import type { StoredMemory } from '@mycelia/store'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounced } from '../../shared/hooks/useAsync.js'
import { cn } from '../../shared/lib/cn.js'
import { KIND_LABELS, kindColor } from '../../shared/lib/labels.js'
import { Icon, type IconName, KindDot, Spinner, TopSheet } from '../../shared/ui/index.js'
import { useApp, type ViewId } from '../../store/app-store.js'
import { NAV_GROUPS } from './Sidebar.js'

interface Row {
  id: string
  icon: IconName
  /** 类型点的颜色，记忆行用它区分类型 */
  dot?: string
  label: string
  hint?: string
  group: string
  run: () => void
}

/**
 * 命令面板。
 *
 * 它同时是搜索框和命令入口 —— 空查询时列命令，输入后并发搜记忆与文档。
 * 键盘全程可用：上下选、回车执行、Esc 关闭，鼠标只是备选路径。
 */
export function CommandPalette() {
  const close = useCallback(() => useApp.getState().openPalette(false), [])
  const setView = useApp((s) => s.setView)
  const openComposer = useApp((s) => s.openComposer)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [memories, setMemories] = useState<StoredMemory[]>([])
  const [docs, setDocs] = useState<DocumentHit[]>([])
  const [searching, setSearching] = useState(false)

  const debounced = useDebounced(query, 160)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const text = debounced.trim()
    if (text.length < 2) {
      setMemories([])
      setDocs([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    // 两条通道并发，谁先回来都不影响另一条
    Promise.allSettled([
      window.mycelia.recall({ text, limit: 6, includePending: true }),
      window.mycelia.searchDocuments(text, { limit: 4 }),
    ])
      .then(([memoryResult, docResult]) => {
        if (cancelled) return
        setMemories(memoryResult.status === 'fulfilled' ? memoryResult.value.memories : [])
        setDocs(docResult.status === 'fulfilled' ? docResult.value : [])
        setSearching(false)
      })
      .catch(() => {
        if (!cancelled) setSearching(false)
      })

    return () => {
      cancelled = true
    }
  }, [debounced])

  const rows = useMemo<Row[]>(() => {
    const text = query.trim().toLowerCase()

    // 分组沿用侧边栏那一套，两处出现的是同一个心智模型
    const navRows: Row[] = NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => ({
        id: `nav:${item.id}`,
        icon: item.icon,
        label: `前往${item.label}`,
        group: group.label ?? '导航',
        run: () => {
          setView(item.id as ViewId)
          close()
        },
      })),
    )

    const commands: Row[] = [
      ...navRows,
      {
        id: 'cmd:new',
        icon: 'plus' as IconName,
        label: '新建记忆',
        hint: '⌘N',
        group: '操作',
        run: () => {
          openComposer(true)
          close()
        },
      },
      {
        id: 'cmd:settings',
        icon: 'settings' as IconName,
        label: '打开设置',
        hint: '⌘,',
        group: '操作',
        run: () => {
          useApp.getState().openSettings(true)
          close()
        },
      },
    ].filter((row) => !text || row.label.toLowerCase().includes(text))

    const memoryRows: Row[] = memories.map((memory) => ({
      id: `mem:${memory.id}`,
      icon: 'memory',
      dot: kindColor(memory.kind),
      label: memory.title,
      hint: KIND_LABELS[memory.kind] ?? memory.kind,
      group: '记忆',
      run: () => {
        setView('memories')
        close()
      },
    }))

    const docRows: Row[] = docs.map((hit) => ({
      id: `doc:${hit.chunkId}`,
      icon: 'file',
      label: hit.document.title || hit.document.relPath,
      hint: hit.heading || hit.source.name,
      group: '文档',
      run: () => {
        setView('library')
        close()
      },
    }))

    return [...memoryRows, ...docRows, ...commands]
  }, [query, memories, docs, setView, openComposer, close])

  // 结果变了就把选中项拉回第一条，否则会指向一个已经不存在的行。
  // 只看 length：内容变化但条数不变时（换了一批同样多的结果），也该回到第一条，
  // 这里接受这点不精确，换来不必对整个 rows 数组做深比较。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只依赖条数是刻意的
  useEffect(() => setActive(0), [rows.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((index) => (index + 1) % Math.max(1, rows.length))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((index) => (index - 1 + rows.length) % Math.max(1, rows.length))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        rows[active]?.run()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rows, active])

  // 键盘移动时把选中项滚进视野
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let lastGroup = ''

  return (
    <TopSheet onClose={close} label="命令面板">
      <div className="flex items-center gap-2.5 h-[46px] px-3.5 border-b border-border shrink-0">
        <Icon name="search" size={15} className="text-faint shrink-0" />
        <input
          // biome-ignore lint/a11y/noAutofocus: 命令面板由用户主动唤起，落焦到输入框正是它的目的
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索记忆、文档，或执行命令…"
          className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint"
        />
        {searching && <Spinner className="text-faint" />}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
        {rows.length === 0 && (
          <p className="px-3.5 py-6 text-center text-[12.5px] text-faint">
            {query.trim().length < 2 ? '输入至少两个字开始搜索' : '没有匹配的结果'}
          </p>
        )}

        {rows.map((row, index) => {
          const showGroup = row.group !== lastGroup
          lastGroup = row.group
          return (
            <div key={row.id}>
              {showGroup && (
                <div className="px-3.5 pt-2 pb-1 text-[10.5px] font-medium text-faint tracking-wide">
                  {row.group}
                </div>
              )}
              <button
                type="button"
                data-index={index}
                onMouseMove={() => setActive(index)}
                onClick={row.run}
                className={cn(
                  'flex items-center gap-2.5 w-full h-[32px] px-3.5 text-left',
                  'transition-colors duration-75',
                  index === active ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                {row.dot ? (
                  <span className="w-[15px] flex justify-center shrink-0">
                    <KindDot color={row.dot} />
                  </span>
                ) : (
                  <Icon name={row.icon} size={14} className="text-faint shrink-0" />
                )}
                <span className="flex-1 min-w-0 text-[13px] truncate">{row.label}</span>
                {row.hint && <span className="text-[11px] text-faint shrink-0">{row.hint}</span>}
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 h-[30px] px-3.5 border-t border-border text-[10.5px] text-faint shrink-0">
        <Hint keys="↑↓" label="选择" />
        <Hint keys="↵" label="打开" />
        <Hint keys="esc" label="关闭" />
      </div>
    </TopSheet>
  )
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="px-1 py-[1px] rounded-[3px] bg-sunken border border-border">{keys}</kbd>
      {label}
    </span>
  )
}
