/**
 * 文件目录知识库的门面。
 *
 * 把「挂载目录 → 索引 → 检索」这条链路收成一个对象，
 * MemoryService 持有它而不是把六七个方法平铺在自己身上。
 */

import { createHash } from 'node:crypto'
import type { Config } from '@mycelia/shared'
import type { MyceliaStore, StoredDocument, StoredSource } from '@mycelia/store'
import type { DocumentIndexer, IndexOptions, IndexResult } from './indexer.js'
import type { DocumentHit, DocumentSearcher, DocumentSearchOptions } from './search.js'

/**
 * 手记源的固定路径。
 *
 * 手写的知识没有对应的磁盘文件，但仍要落在某个知识源下（文档表有外键）。
 * 用一个 mycelia:// 伪路径把它和真实目录区分开：扫描、监听那套逻辑
 * 认路径找文件，遇到这个 scheme 就不会去碰文件系统。
 */
export const NOTES_SOURCE_PATH = 'mycelia://notes'
const NOTES_SOURCE_NAME = '手记'

/** 标题 → 文件名。手记没有真实路径，靠标题生成一个稳定的 relPath */
function slugify(title: string, fallback: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${cleaned || fallback}.md`
}

export class KnowledgeLibrary {
  constructor(
    private readonly store: MyceliaStore,
    private readonly indexer: DocumentIndexer,
    private readonly searcher: DocumentSearcher,
    private readonly config: Config,
  ) {}

  /** 检索文档块。返回的是 small-to-big 扩展后的完整段落 */
  searchDocuments(query: string, opts: DocumentSearchOptions = {}): Promise<DocumentHit[]> {
    return this.searcher.search(query, opts)
  }

  addSource(input: { name: string; path: string; extensions?: string[] }): StoredSource {
    return this.store.sources.add({
      ...input,
      extensions: input.extensions ?? this.config.knowledge.sources[0]?.extensions,
    })
  }

  removeSource(id: string): boolean {
    const docs = this.store.documents.bySource(id)
    for (const doc of docs) this.store.chunkVectors.forget(this.store.documents.remove(doc.id))
    return this.store.sources.remove(id)
  }

  /** 手记源，没有就建一个。用户不需要先「挂载」才能写第一条笔记 */
  notesSource(): StoredSource {
    const existing = this.store.sources.byPath(NOTES_SOURCE_PATH)
    if (existing) return existing
    return this.store.sources.add({
      name: NOTES_SOURCE_NAME,
      path: NOTES_SOURCE_PATH,
      extensions: ['md'],
    })
  }

  /**
   * 手写一篇知识入库。
   *
   * 走的是和挂载目录完全相同的管线，所以手记与文件在检索时是平等的 ——
   * 不会因为「手动加的」而排在后面或被切得更碎。
   *
   * 传 documentId 表示编辑已有的那篇：底层按 (sourceId, relPath) 覆盖，
   * 改标题会换 relPath，所以要先把旧的删掉，否则会留下一份孤儿文档。
   */
  async saveNote(input: {
    title: string
    text: string
    documentId?: string
  }): Promise<{ documentId: string; chunkCount: number }> {
    const title = input.title.trim()
    const text = input.text.trim()
    if (!title) throw new Error('标题不能为空')
    if (!text) throw new Error('正文不能为空')

    const source = this.notesSource()
    const previous = input.documentId ? this.store.documents.get(input.documentId) : undefined
    const relPath = slugify(title, createHash('sha256').update(title).digest('hex').slice(0, 8))

    if (previous && previous.relPath !== relPath) {
      this.store.chunkVectors.forget(this.store.documents.remove(previous.id))
    }

    const result = await this.indexer.ingestText(
      source,
      {
        relPath,
        absPath: `${NOTES_SOURCE_PATH}/${relPath}`,
        title,
        sizeBytes: Buffer.byteLength(text, 'utf8'),
      },
      // 正文前面补一个一级标题：分块器靠标题层级切分并生成标题路径，
      // 没有标题的话整篇会退化成一堆无归属的段落
      `# ${title}\n\n${text}`,
      { force: true },
    )

    const saved = this.store.documents.byRelPath(source.id, relPath)
    this.store.sources.refreshCounts(source.id)
    if (!saved) throw new Error('写入失败')
    return { documentId: saved.id, chunkCount: result.chunkCount }
  }

  /** 读回手记原文，供编辑。文件类文档不走这里 —— 它们的事实来源是磁盘 */
  noteText(documentId: string): { document: StoredDocument; text: string } | undefined {
    const document = this.store.documents.get(documentId)
    if (!document) return undefined
    const text = this.store.chunks
      .byDocument(documentId)
      .map((chunk) => chunk.content)
      .join('\n\n')
      .replace(/^#\s+.*\n+/, '')
    return { document, text }
  }

  indexSource(id: string, opts: IndexOptions = {}): Promise<IndexResult> {
    const source = this.store.sources.get(id)
    if (!source) throw new Error(`知识源不存在：${id}`)
    return this.indexer.indexSource(source, opts)
  }

  indexAllSources(opts: IndexOptions = {}): Promise<IndexResult[]> {
    return this.indexer.indexAll(opts)
  }
}
