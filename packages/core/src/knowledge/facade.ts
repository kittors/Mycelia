/**
 * 文件目录知识库的门面。
 *
 * 把「挂载目录 → 索引 → 检索」这条链路收成一个对象，
 * MemoryService 持有它而不是把六七个方法平铺在自己身上。
 */

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LlmProvider } from '@mycelia/llm'
import type { Config } from '@mycelia/shared'
import { libraryDir } from '@mycelia/shared'
import type { MyceliaStore, StoredDocument, StoredSource } from '@mycelia/store'
import { type HarvestResult, harvestDocument } from './harvest.js'
import type { DocumentIndexer, IndexOptions, IndexResult } from './indexer.js'
import type { DocumentHit, DocumentSearcher, DocumentSearchOptions } from './search.js'

/**
 * 手记源的固定路径。
 *
 * 手写的知识没有对应的磁盘文件，但仍要落在某个知识源下（文档表有外键）。
 * 用一个 mycelia:// 伪路径把它和真实目录区分开：扫描、监听那套逻辑
 * 认路径找文件，遇到这个 scheme 就不会去碰文件系统。
 */
/**
 * 应用自己的文档库。
 *
 * 以前这里是个虚拟路径（mycelia://notes），文档只存在数据库里 ——
 * 结果是「文档库」根本没有库：卸载应用内容就没了，也没法用别的编辑器打开，
 * 更没法用 git 管。现在落成真实目录下的真实 .md 文件，数据库退回它该待的
 * 位置：索引，而不是正本。
 */
export const NOTES_SOURCE_PATH = libraryDir()
const NOTES_SOURCE_NAME = '我的文档'

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
    /** 提炼记忆要用。没配模型时 harvest 直接跳过，不降级到规则 */
    private readonly llm: LlmProvider,
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

  /**
   * 应用自带的文档库，没有就建一个。
   *
   * 不需要先「挂载」才能写第一篇 —— 挂载是给已有的外部笔记用的，
   * 而这个库是应用自己的地盘，开箱就在。
   */
  notesSource(): StoredSource {
    mkdirSync(NOTES_SOURCE_PATH, { recursive: true })
    const existing = this.store.sources.byPath(NOTES_SOURCE_PATH)
    if (existing) return existing

    // 老版本把手记存在虚拟路径下，接管它而不是另起一个，否则旧文档会失联
    const legacy = this.store.sources.byPath('mycelia://notes')
    if (legacy) {
      this.store.sources.relocate(legacy.id, NOTES_SOURCE_PATH, NOTES_SOURCE_NAME)
      return this.store.sources.get(legacy.id) as StoredSource
    }

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
      // 文件名跟着标题走，改完标题旧文件就该消失，否则库里会多出一份幽灵
      await rm(join(NOTES_SOURCE_PATH, previous.relPath), { force: true })
    }

    /**
     * 先落盘，再索引。
     *
     * 顺序不能反：索引成功而文件没写成，库里就有一篇磁盘上不存在的文档，
     * 点「打开原文件」会失败，下次全量重建又会把它当成已删除清掉。
     */
    const absPath = join(NOTES_SOURCE_PATH, relPath)
    const body = `# ${title}\n\n${text}\n`
    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, body, 'utf8')

    const result = await this.indexer.ingestText(
      source,
      {
        relPath,
        absPath,
        title,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
      },
      body,
      { force: true },
    )

    const saved = this.store.documents.byRelPath(source.id, relPath)
    this.store.sources.refreshCounts(source.id)
    if (!saved) throw new Error('写入失败')
    return { documentId: saved.id, chunkCount: result.chunkCount }
  }

  /**
   * 读一篇文档的正文，供编辑。
   *
   * 挂载目录的文档直接读磁盘 —— 库里存的是切过的块，拼回来跟原文并不相等
   * （块之间用空行硬连、一级标题被剥掉过），拿它当原文保存会把用户的文件毁掉。
   * 手记没有磁盘正本，只能从块拼回来，那也是它唯一的形态。
   */
  async documentText(documentId: string): Promise<
    | {
        document: StoredDocument
        text: string
        /** true 表示正本在磁盘上，保存要写回文件并重新索引 */
        onDisk: boolean
      }
    | undefined
  > {
    const document = this.store.documents.get(documentId)
    if (!document) return undefined

    const source = this.store.sources.get(document.sourceId)
    const onDisk = Boolean(source && source.path !== NOTES_SOURCE_PATH)
    if (!onDisk) {
      const note = this.noteText(documentId)
      return note ? { ...note, onDisk: false } : undefined
    }

    try {
      return { document, text: await readFile(document.absPath, 'utf8'), onDisk: true }
    } catch {
      // 文件被删或没权限：退回块拼接，至少还能看
      const note = this.noteText(documentId)
      return note ? { ...note, onDisk: true } : undefined
    }
  }

  /**
   * 把改动写回磁盘上的原文件，然后重新索引它。
   *
   * 只重索引这一个文件而不是整个目录：目录里可能有几千篇，为改一行等上
   * 半分钟是没道理的。
   */
  async writeDocument(documentId: string, text: string): Promise<{ chunkCount: number }> {
    const document = this.store.documents.get(documentId)
    if (!document) throw new Error('文档不存在')
    const source = this.store.sources.get(document.sourceId)
    if (!source || source.path === NOTES_SOURCE_PATH) {
      throw new Error('这篇没有磁盘正本，请用 saveNote')
    }

    await writeFile(document.absPath, text, 'utf8')
    const stats = await stat(document.absPath)
    const result = await this.indexer.ingestText(
      source,
      {
        relPath: document.relPath,
        absPath: document.absPath,
        sizeBytes: stats.size,
        mtime: stats.mtimeMs,
      },
      text,
      { force: true },
    )
    this.store.sources.refreshCounts(source.id)
    return { chunkCount: result.chunkCount }
  }

  /** 读回手记原文。文件类文档不走这里 —— 它们的事实来源是磁盘 */
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

  /**
   * 从一批文档里提炼候选记忆。
   *
   * 挂载一个几十篇的目录时是一次几十回模型调用，所以做成显式动作而不是
   * 索引时自动跑 —— 索引是「让文档可被检索」，提炼是「决定哪些内容值得
   * 成为长期记忆」，后者花钱、需要审阅，不该在用户没准备好时偷偷发生。
   */
  async harvest(
    documentIds: readonly string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<HarvestResult[]> {
    const results: HarvestResult[] = []
    let done = 0
    for (const id of documentIds) {
      const found = await this.documentText(id)
      if (!found) continue
      results.push(
        await harvestDocument(this.store, this.llm, this.config, found.document, found.text),
      )
      onProgress?.(++done, documentIds.length)
    }
    return results
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
