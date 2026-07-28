import type { MemoryKind } from '@mycelia/shared'
import type { StoredMemory } from '@mycelia/store'
import { useCallback, useEffect, useState } from 'react'
import type { MemoryDetail } from '../../../../shared/ipc-contract.js'
import { useAsync, useDebounced } from '../../shared/hooks/useAsync.js'
import { useDelayedFlag } from '../../shared/hooks/useDelayedFlag.js'
import { cn } from '../../shared/lib/cn.js'
import { KIND_LABELS, kindColor } from '../../shared/lib/labels.js'
import { Chip, Empty, Icon, Input, SkeletonRow } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'
import { MemoryInspector } from './MemoryInspector.js'
import { MemoryRow } from './MemoryRow.js'

const KIND_FILTERS = Object.entries(KIND_LABELS)

export function MemoriesView() {
  const revision = useApp((s) => s.revision)
  const fail = useApp((s) => s.fail)

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<MemoryKind | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MemoryDetail | null>(null)

  const debouncedQuery = useDebounced(query)

  const { data, loading } = useAsync(async () => {
    const text = debouncedQuery.trim()
    // 有查询走混合检索，没有就按筛选条件列表 —— 两条路径的排序语义不同，
    // 检索按相关度，浏览按更新时间
    if (text) {
      const result = await window.mycelia.recall({
        text,
        limit: 100,
        kinds: kind ? [kind] : undefined,
        includePending: true,
      })
      return { memories: result.memories, total: result.memories.length, searched: true }
    }
    const result = await window.mycelia.listMemories({
      kinds: kind ? [kind] : undefined,
      status: ['active', 'pending'],
      limit: 200,
      orderBy: 'updated',
    })
    return { memories: result.memories, total: result.total, searched: false }
  }, [debouncedQuery, kind, revision])

  const select = useCallback(
    async (id: string) => {
      setSelectedId(id)
      try {
        setDetail(await window.mycelia.getMemory(id))
      } catch (error) {
        fail(error)
      }
    },
    [fail],
  )

  // 选中的记忆被删掉后，详情面板要跟着关掉
  useEffect(() => {
    if (!selectedId || !data) return
    if (!data.memories.some((memory: StoredMemory) => memory.id === selectedId)) {
      setSelectedId(null)
      setDetail(null)
    }
  }, [data, selectedId])

  const memories = data?.memories ?? []
  const showSkeleton = useDelayedFlag(loading && memories.length === 0)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-2 px-4 py-3 shrink-0">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: 内部就是 Input 渲染出的 input */}
          <label className="relative flex-1 max-w-[420px]">
            <Icon
              name="search"
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="语义检索，或直接输关键词"
              className="pl-8"
            />
          </label>
          <span className="text-[11.5px] text-faint tabular shrink-0">
            {data ? `${data.total} 条` : ''}
          </span>
        </div>

        <div className="flex gap-1.5 px-4 pb-2.5 overflow-x-auto shrink-0">
          <Chip active={kind === null} onClick={() => setKind(null)}>
            全部
          </Chip>
          {KIND_FILTERS.map(([id, label]) => (
            <Chip
              key={id}
              active={kind === id}
              color={kindColor(id)}
              onClick={() => setKind(kind === id ? null : (id as MemoryKind))}
            >
              {label}
            </Chip>
          ))}
        </div>

        <div className={cn('flex-1 min-h-0 overflow-y-auto px-2 pb-4', 'border-t border-border')}>
          {loading && memories.length === 0 && showSkeleton && (
            <div className="flex flex-col pt-1.5 animate-fade-in">
              {Array.from({ length: 8 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
                <SkeletonRow key={index} index={index} trailing="text" className="h-[42px]" />
              ))}
            </div>
          )}

          {!loading && memories.length === 0 && (
            <Empty
              icon={<Icon name="memory" size={26} />}
              title={query.trim() ? '没有匹配的记忆' : '记忆库还是空的'}
              description={
                query.trim()
                  ? '换个说法试试。检索同时走语义与关键词，专有名词直接输入即可。'
                  : '接入 agent 后，它会在对话中判断哪些内容值得长期留存并写入这里。'
              }
            />
          )}

          <div className="flex flex-col gap-[1px] pt-1.5">
            {memories.map((memory: StoredMemory, index: number) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                index={index}
                selected={memory.id === selectedId}
                onSelect={select}
              />
            ))}
          </div>
        </div>
      </div>

      <MemoryInspector
        detail={detail}
        onClose={() => {
          setDetail(null)
          setSelectedId(null)
        }}
        onOpenMemory={select}
      />
    </div>
  )
}
