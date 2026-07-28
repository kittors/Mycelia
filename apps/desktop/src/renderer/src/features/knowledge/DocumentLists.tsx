/**
 * 文档库的两种列表：检索结果与目录浏览。
 *
 * 从 KnowledgeView 拆出来 —— 那边负责编排数据与状态，
 * 这里只管把结果画出来，两者的改动理由不一样。
 */

import type { DocumentHit } from '@mycelia/core'
import type { StoredDocument, StoredSource } from '@mycelia/store'
import { cn } from '../../shared/lib/cn.js'
import { formatBytes, truncatePath } from '../../shared/lib/format.js'
import { Empty, Icon, Skeleton, SkeletonRow, SkeletonText } from '../../shared/ui/index.js'

export function SearchResults({
  hits,
  loading,
  onOpen,
}: {
  hits: DocumentHit[]
  loading: boolean
  onOpen: (documentId: string) => void
}) {
  if (loading && hits.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-3 animate-fade-in">
        {Array.from({ length: 4 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-[10px] w-[42%] rounded-full" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
    )
  }

  if (hits.length === 0) {
    return (
      <Empty
        icon={<Icon name="search" size={24} />}
        title="没有命中"
        description="检索同时走语义与关键词。如果目录刚挂上，可能还在索引中。"
      />
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {hits.map((hit, index) => (
        <button
          key={hit.chunkId}
          type="button"
          onClick={() => onOpen(hit.documentId)}
          className={cn(
            'flex flex-col gap-1.5 px-3 py-2.5 rounded-[8px] text-left',
            'hover:bg-hover transition-colors duration-100 stagger',
          )}
          style={{ animationDelay: `${Math.min(index, 10) * 16}ms` }}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Icon name="file" size={13} className="text-faint shrink-0" />
            <span className="text-[12.5px] font-medium truncate">
              {hit.document.title || hit.document.relPath}
            </span>
            {hit.heading && (
              <span className="text-[11px] text-faint truncate">› {hit.heading}</span>
            )}
          </span>

          {/* 展示的是 small-to-big 扩展后的上下文，不是孤零零的命中块 */}
          <span className="text-[12px] text-muted leading-relaxed line-clamp-3" data-selectable>
            {hit.context}
          </span>

          <span className="flex items-center gap-2 text-[10.5px] text-faint">
            <span>{hit.source.name}</span>
            <span className="opacity-50">·</span>
            <span className="truncate">{truncatePath(hit.document.relPath, 40)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function DocumentList({
  documents,
  loading,
  hasSelection,
  onOpen,
}: {
  documents: StoredDocument[]
  loading: boolean
  hasSelection: boolean
  onOpen: (documentId: string) => void
}) {
  if (!hasSelection) {
    return (
      <Empty
        icon={<Icon name="folder" size={24} />}
        title="选择一个目录"
        description="或者直接在上方搜索，跨全部目录检索。"
      />
    )
  }

  if (loading && documents.length === 0) {
    return (
      <div className="flex flex-col animate-fade-in">
        {Array.from({ length: 10 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
          <SkeletonRow key={index} index={index} trailing="text" className="h-[34px]" />
        ))}
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <Empty
        icon={<Icon name="file" size={24} />}
        title="这个目录还没有索引结果"
        description="可能是目录里没有匹配扩展名的文件，或索引尚未完成。"
      />
    )
  }

  return (
    <div className="flex flex-col gap-[1px]">
      {documents.map((doc, index) => (
        <button
          key={doc.id}
          type="button"
          onClick={() => onOpen(doc.id)}
          className={cn(
            'flex items-center gap-2.5 px-3 h-[34px] rounded-[7px] text-left',
            'hover:bg-hover transition-colors duration-100 stagger',
          )}
          style={{ animationDelay: `${Math.min(index, 14) * 10}ms` }}
        >
          <Icon name="file" size={13} className="text-faint shrink-0" />
          <span className="text-[12.5px] truncate flex-1">{doc.title || doc.relPath}</span>
          <span className="text-[10.5px] text-faint truncate max-w-[200px] hidden sm:inline">
            {truncatePath(doc.relPath, 34)}
          </span>
          <span className="text-[10.5px] text-faint tabular shrink-0">{doc.chunkCount} 片段</span>
          <span className="text-[10.5px] text-faint tabular shrink-0 w-[52px] text-right">
            {formatBytes(doc.sizeBytes)}
          </span>
        </button>
      ))}
    </div>
  )
}

export type { StoredSource }
