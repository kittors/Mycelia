/**
 * 文件目录索引器：目录 → 文档 → 块 → 向量。
 *
 * 三个设计要点：
 *
 *   1. **增量优先**。索引的依据是内容哈希而不是 mtime —— 编辑器保存、git checkout、
 *      同步盘回写都会改 mtime 但内容没变，按 mtime 判断会导致整库反复重嵌入。
 *
 *   2. **逐文档提交**。每个文件独立成事务并立即落库，而不是全扫完再统一写。
 *      索引一个几千文件的目录要几分钟，中途取消或崩溃时已完成的部分不该白干。
 *
 *   3. **可中断**。signal 在每个文件边界检查，用户在 UI 上点取消能立刻停下，
 *      而不是等整个目录跑完。
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { Embedder } from '@mycelia/embed'
import { createVision, type LlmProvider, type VisionProvider } from '@mycelia/llm'
import type { Config } from '@mycelia/shared'
import { createLogger, mapLimit } from '@mycelia/shared'
import type { MyceliaStore, StoredSource } from '@mycelia/store'
import { chunkDocument } from './chunk/index.js'
import {
  collectHeadings,
  contextualizeChunks,
  needsSemanticContext,
  summarizeDocument,
} from './context.js'
import { indexImage } from './index-image.js'
import { extractTitle, type ScannedFile, scanDirectory } from './scan.js'

const log = createLogger('core:knowledge:indexer')

export interface IndexProgress {
  /** 已处理文件数 */
  done: number
  /** 待处理文件总数 */
  total: number
  /** 当前文件的相对路径 */
  current: string
}

export interface IndexOptions {
  /** 忽略内容哈希，强制全量重建 */
  force?: boolean
  onProgress?: (progress: IndexProgress) => void
  signal?: AbortSignal
}

export interface IndexResult {
  sourceId: string
  scannedFiles: number
  indexedDocuments: number
  skippedDocuments: number
  removedDocuments: number
  createdChunks: number
  contextualizedChunks: number
  errors: string[]
  durationMs: number
}

export class DocumentIndexer {
  constructor(
    private readonly store: MyceliaStore,
    private readonly embedder: Embedder,
    private readonly llm: LlmProvider,
    private readonly config: Config,
    /** 识图。没配就是个空实现，图片只登记文件名 */
    private readonly vision: VisionProvider = createVision(
      { ...config.vision, enabled: false },
      { baseUrl: '' },
    ),
  ) {}

  /** 索引一个知识源。返回统计供 UI 展示 */
  async indexSource(source: StoredSource, opts: IndexOptions = {}): Promise<IndexResult> {
    const started = Date.now()
    const result: IndexResult = {
      sourceId: source.id,
      scannedFiles: 0,
      indexedDocuments: 0,
      skippedDocuments: 0,
      removedDocuments: 0,
      createdChunks: 0,
      contextualizedChunks: 0,
      errors: [],
      durationMs: 0,
    }

    this.store.sources.setStatus(source.id, 'indexing')

    try {
      const files = await scanDirectory(source, {
        includeImages: this.config.knowledge.indexImages,
      })
      result.scannedFiles = files.length

      // 磁盘上已经没有的文件，把索引一并清掉 —— 否则检索会命中幽灵文档
      const known = this.store.documents.bySource(source.id)
      const alive = new Set(files.map((f) => f.relPath))
      for (const doc of known) {
        if (alive.has(doc.relPath)) continue
        const removed = this.store.documents.remove(doc.id)
        this.store.chunkVectors.forget(removed)
        result.removedDocuments++
      }

      let done = 0
      for (const file of files) {
        if (opts.signal?.aborted) {
          log.info(`索引被取消，已完成 ${done}/${files.length}`)
          break
        }
        opts.onProgress?.({ done, total: files.length, current: file.relPath })

        try {
          const outcome = await this.indexFile(source, file, opts)
          if (outcome.skipped) {
            result.skippedDocuments++
          } else {
            result.indexedDocuments++
            result.createdChunks += outcome.chunkCount
            result.contextualizedChunks += outcome.contextualized
          }
        } catch (e) {
          const message = `${file.relPath}：${e instanceof Error ? e.message : String(e)}`
          result.errors.push(message)
          log.warn(`索引文件失败 ${message}`)
        }

        done++
      }

      opts.onProgress?.({ done, total: files.length, current: '' })
      this.store.sources.refreshCounts(source.id)
      this.store.sources.setStatus(source.id, 'idle')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.store.sources.setStatus(source.id, 'error', message)
      result.errors.push(message)
    }

    result.durationMs = Date.now() - started
    return result
  }

  /** 索引单个文件。内容没变就跳过，连读都不用重读第二遍 */
  private async indexFile(
    source: StoredSource,
    file: ScannedFile,
    opts: IndexOptions,
  ): Promise<{ skipped: boolean; chunkCount: number; contextualized: number }> {
    if (file.isImage) {
      return indexImage(
        {
          store: this.store,
          config: this.config,
          vision: this.vision,
          ingestText: (...args) => this.ingestText(...args),
        },
        source,
        file,
        opts,
      )
    }

    const raw = await readFile(file.absPath, 'utf8')
    const contentHash = createHash('sha256').update(raw).digest('hex')

    const existing = this.store.documents.byRelPath(source.id, file.relPath)
    if (!opts.force && existing?.contentHash === contentHash) {
      return { skipped: true, chunkCount: 0, contextualized: 0 }
    }

    return this.ingestText(
      source,
      {
        relPath: file.relPath,
        absPath: file.absPath,
        sizeBytes: file.sizeBytes,
        mtime: file.mtime,
        contentHash,
      },
      raw,
      opts,
    )
  }

  /**
   * 把一段文本写进知识库，走与文件完全相同的分块、上下文增强与嵌入管线。
   *
   * 抽出来是为了让手写笔记和挂载目录共用一条路：如果给手动添加另写一套
   * 简化流程，同一段文字从两个入口进来会被切成不一样的块、拿到不一样的向量，
   * 检索结果也就对不上了。
   */
  async ingestText(
    source: StoredSource,
    meta: {
      relPath: string
      absPath: string
      title?: string
      sizeBytes?: number
      mtime?: number
      contentHash?: string
    },
    raw: string,
    opts: IndexOptions = {},
  ): Promise<{ skipped: boolean; chunkCount: number; contextualized: number }> {
    const contentHash = meta.contentHash ?? createHash('sha256').update(raw).digest('hex')
    const knowledge = this.config.knowledge
    const chunks = chunkDocument(raw, {
      chunkSize: knowledge.chunkSize,
      chunkOverlap: knowledge.chunkOverlap,
    })
    if (chunks.length === 0) {
      return { skipped: true, chunkCount: 0, contextualized: 0 }
    }

    const file = { relPath: meta.relPath, absPath: meta.absPath }
    const title = meta.title?.trim() || extractTitle(raw, meta.relPath)

    // 只有结构撑不住分块粒度的文档才值得花模型调用。
    // 一份标题层级完整的文档，靠标题路径定位已经足够。
    const useLlmContext = this.llm.enabled && needsSemanticContext(raw, chunks.length)
    const docContext = useLlmContext
      ? await summarizeDocument(this.llm, this.config.llm, {
          title,
          text: raw,
          headings: collectHeadings(raw),
        })
      : { title, summary: '' }

    const enriched = await contextualizeChunks(this.llm, this.config.llm, docContext, chunks, {
      enabled: useLlmContext,
      concurrency: 4,
      signal: opts.signal,
    })

    // 嵌入的是「定位说明 + 原文」，落库的正文仍是干净的原文
    const vectors = await mapLimit(enriched, this.config.embedding.concurrency, async (chunk) =>
      this.embedder.embedOne(chunk.embedText),
    )

    const { chunkIds, removedChunkIds } = this.store.documents.replace(
      {
        sourceId: source.id,
        relPath: file.relPath,
        absPath: file.absPath,
        title,
        ext: extname(file.relPath).replace(/^\./, ''),
        sizeBytes: meta.sizeBytes ?? Buffer.byteLength(raw, 'utf8'),
        mtime: meta.mtime ?? Date.now(),
        contentHash,
      },
      enriched.map((chunk) => ({
        ord: chunk.ord,
        heading: chunk.heading,
        content: chunk.content,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
      })),
    )

    this.store.chunkVectors.forget(removedChunkIds)
    this.store.chunkVectors.upsertMany(
      this.store.db,
      this.embedder.id,
      chunkIds.map((id, index) => ({ id, vector: vectors[index]! })),
    )

    return {
      skipped: false,
      chunkCount: chunkIds.length,
      contextualized: useLlmContext ? chunkIds.length : 0,
    }
  }

  /** 索引全部启用的知识源 */
  async indexAll(opts: IndexOptions = {}): Promise<IndexResult[]> {
    const sources = this.store.sources.all().filter((s) => s.enabled)
    const results: IndexResult[] = []
    for (const source of sources) {
      if (opts.signal?.aborted) break
      results.push(await this.indexSource(source, opts))
    }
    return results
  }
}

/** 递归扫描目录，返回符合扩展名且未被排除的文件 */
