import { useCallback, useState } from 'react'
import { useAsync, useDebounced } from '../../shared/hooks/useAsync.js'
import { relativeTime } from '../../shared/lib/format.js'
import { Button, Empty, Icon, IconButton, Input, Spinner } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'
import { DocumentEditor } from './DocumentEditor.js'
import { DocumentList, SearchResults } from './DocumentLists.js'
import { DocumentReader } from './DocumentReader.js'
import { SourceList } from './SourceList.js'

/**
 * 文档库。
 *
 * 三层知识库里的文件层：用户本地文档目录的只读镜像。
 * 与记忆库的分工 —— 记忆是沉淀下来的结论，这里是原始出处。
 */
export function KnowledgeView() {
  const revision = useApp((s) => s.revision)
  const indexing = useApp((s) => s.indexing)
  const app = useApp()

  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openDocId, setOpenDocId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  /** 正在编辑的手记 id。null 表示新建 */
  const [editingId, setEditingId] = useState<string | null>(null)

  const debouncedQuery = useDebounced(query)

  const { data: sources, loading: sourcesLoading } = useAsync(
    () => window.mycelia.listSources(),
    [revision],
  )

  // 搜索态与浏览态是两套结果，用一个 hook 装不下，分开更清晰
  const { data: hits, loading: searching } = useAsync(async () => {
    const text = debouncedQuery.trim()
    if (text.length < 2) return null
    return window.mycelia.searchDocuments(text, {
      limit: 20,
      sourceIds: activeSourceId ? [activeSourceId] : undefined,
    })
  }, [debouncedQuery, activeSourceId, revision])

  const { data: documents, loading: docsLoading } = useAsync(async () => {
    if (debouncedQuery.trim().length >= 2) return null
    if (!activeSourceId) return null
    return window.mycelia.listDocuments(activeSourceId)
  }, [activeSourceId, debouncedQuery, revision])

  const addSource = useCallback(async () => {
    try {
      const source = await window.mycelia.pickAndAddSource()
      if (source) {
        app.toast(`已挂载「${source.name}」，正在索引`, 'success')
        setActiveSourceId(source.id)
        app.bump()
      }
    } catch (error) {
      app.fail(error)
    }
  }, [app])

  const hasSources = (sources?.length ?? 0) > 0
  const searchMode = debouncedQuery.trim().length >= 2

  if (!sourcesLoading && !hasSources) {
    return (
      <div className="relative flex items-center justify-center h-full">
        <Empty
          icon={<Icon name="library" size={30} />}
          title="还没有文档"
          description="两条路：挂载一个已有的目录，Mycelia 只读不写地为它建索引；或者直接在这里新建一篇，写完同样会被切分、向量化。两者在检索时是平等的。"
          action={
            <div className="flex items-center gap-2">
              <Button variant="primary" icon={<Icon name="plus" size={14} />} onClick={addSource}>
                选择目录
              </Button>
              {/* 手边没有现成目录时也得有路可走，否则空知识库是个死胡同 */}
              <Button icon={<Icon name="edit" size={14} />} onClick={() => setComposing(true)}>
                新建文档
              </Button>
            </div>
          }
        />
        {composing && (
          <DocumentEditor
            onClose={() => setComposing(false)}
            onSaved={(id) => {
              setComposing(false)
              setOpenDocId(id)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0">
      <SourceList
        sources={sources ?? []}
        loading={sourcesLoading}
        activeId={activeSourceId}
        onSelect={setActiveSourceId}
        onAdd={addSource}
      />

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
              placeholder={activeSourceId ? '在这个目录里检索…' : '在全部文档中检索，返回原文片段'}
              className="pl-8"
            />
          </label>
          <Button
            size="sm"
            icon={<Icon name="edit" size={13} />}
            onClick={() => setComposing(true)}
          >
            新建文档
          </Button>
          {searching && <Spinner className="text-faint" />}
          {indexing && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
              <span className="truncate max-w-[180px]">{indexing.current}</span>
              <span className="tabular">
                {indexing.done}/{indexing.total}
              </span>
            </span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border-t border-border px-2 py-2">
          {searchMode ? (
            <SearchResults hits={hits ?? []} loading={searching} onOpen={setOpenDocId} />
          ) : (
            <DocumentList
              documents={documents ?? []}
              loading={docsLoading}
              hasSelection={activeSourceId !== null}
              onOpen={setOpenDocId}
            />
          )}
        </div>
      </div>

      {openDocId && (
        <DocumentReader
          documentId={openDocId}
          onClose={() => setOpenDocId(null)}
          onEdit={() => {
            setEditingId(openDocId)
            setComposing(true)
            setOpenDocId(null)
          }}
        />
      )}
      {composing && (
        <DocumentEditor
          documentId={editingId ?? undefined}
          onClose={() => {
            setComposing(false)
            setEditingId(null)
          }}
          onSaved={(id) => {
            setComposing(false)
            setEditingId(null)
            setOpenDocId(id)
          }}
        />
      )}
    </div>
  )
}

export { IconButton, relativeTime }
