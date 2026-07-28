/**
 * 文件目录知识库的类型与行映射。
 *
 * 数据库行（snake_case、数字布尔）与领域对象（camelCase、真布尔）在这里收口。
 * 三个仓储只处理 SQL，不重复写映射。
 */

import { safeParse } from '../rows.js'

export type SourceStatus = 'idle' | 'indexing' | 'error'

/** 一个被挂载的文档目录 */
export interface StoredSource {
  id: string
  name: string
  path: string
  enabled: boolean
  watch: boolean
  extensions: string[]
  exclude: string[]
  status: SourceStatus
  error?: string
  docCount: number
  chunkCount: number
  lastIndexedAt?: number
  createdAt: number
  updatedAt: number
}

/** 目录下的一个文件。contentHash 是增量索引的依据 */
export interface StoredDocument {
  id: string
  sourceId: string
  relPath: string
  absPath: string
  title: string
  ext: string
  sizeBytes: number
  mtime: number
  contentHash: string
  chunkCount: number
  indexedAt: number
}

/** 文档切出来的一块。charStart/charEnd 用于回溯原文位置 */
export interface StoredChunk {
  id: string
  documentId: string
  sourceId: string
  ord: number
  heading: string
  content: string
  charStart: number
  charEnd: number
  createdAt: number
}

export interface ChunkInput {
  ord: number
  heading: string
  content: string
  charStart: number
  charEnd: number
}

// ─────────────────────────── 数据库行 ───────────────────────────

export interface SourceRow {
  id: string
  name: string
  path: string
  enabled: number
  watch: number
  extensions: string
  exclude: string
  status: string
  error: string | null
  doc_count: number
  chunk_count: number
  last_indexed_at: number | null
  created_at: number
  updated_at: number
}

export interface DocumentRow {
  id: string
  source_id: string
  rel_path: string
  abs_path: string
  title: string
  ext: string
  size_bytes: number
  mtime: number
  content_hash: string
  chunk_count: number
  indexed_at: number
}

export interface ChunkRow {
  id: string
  document_id: string
  source_id: string
  ord: number
  heading: string
  content: string
  char_start: number
  char_end: number
  created_at: number
}

// ─────────────────────────── 映射 ───────────────────────────

export function toSource(row: SourceRow): StoredSource {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    enabled: row.enabled === 1,
    watch: row.watch === 1,
    extensions: safeParse<string[]>(row.extensions, ['md']),
    exclude: safeParse<string[]>(row.exclude, []),
    status: row.status as SourceStatus,
    error: row.error ?? undefined,
    docCount: row.doc_count,
    chunkCount: row.chunk_count,
    lastIndexedAt: row.last_indexed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toDocument(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    sourceId: row.source_id,
    relPath: row.rel_path,
    absPath: row.abs_path,
    title: row.title,
    ext: row.ext,
    sizeBytes: row.size_bytes,
    mtime: row.mtime,
    contentHash: row.content_hash,
    chunkCount: row.chunk_count,
    indexedAt: row.indexed_at,
  }
}

export function toChunk(row: ChunkRow): StoredChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    sourceId: row.source_id,
    ord: row.ord,
    heading: row.heading,
    content: row.content,
    charStart: row.char_start,
    charEnd: row.char_end,
    createdAt: row.created_at,
  }
}
