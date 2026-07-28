import type { Embedder } from '@mycelia/embed'
import type { IngestService } from '@mycelia/ingest'
import type { LlmProvider } from '@mycelia/llm'
import type {
  AgentSource,
  Config,
  GraphSnapshot,
  MemoryInput,
  MemoryKind,
  MemoryPatch,
  SearchQuery,
  Sensitivity,
} from '@mycelia/shared'
import { createLogger, hashContent, newId, truncate } from '@mycelia/shared'
import { MyceliaStore, type StoredMemory, type StoredSource } from '@mycelia/store'
import { assembleService } from './assemble.js'
import type { CaptureCandidate, CaptureDecision, CaptureGate } from './capture.js'
import { type CaptureOptions, runCapture } from './capture-flow.js'
import { generateDigest, weeklyDigest } from './digest.js'
import type { MemoryExtractor } from './extract/index.js'
import type { GraphBuilder } from './graph/build.js'
import { buildSnapshot, type SnapshotOptions } from './graph/snapshot/index.js'
import type {
  DocumentHit,
  DocumentIndexer,
  DocumentSearcher,
  DocumentSearchOptions,
  IndexOptions,
  IndexResult,
  KnowledgeLibrary,
} from './knowledge/index.js'
import type { ExtractionPipeline, PipelineOptions, PipelineResult } from './pipeline.js'
import type { RetrievalResult, Retriever } from './retrieval.js'

const log = createLogger('core:service')

export interface ServiceOptions {
  dbPath?: string
  vaultPath?: string
  config?: Config
}

/**
 * 统一门面。
 *
 * MCP server、CLI、Electron 主进程都通过它操作记忆库 —— 三个入口共享
 * 同一套业务规则。任何「记忆该怎么存、怎么查」的决策只在这里写一遍。
 */
export class MemoryService {
  readonly store: MyceliaStore
  readonly config: Config
  readonly embedder: Embedder
  readonly llm: LlmProvider
  readonly retriever: Retriever
  readonly pipeline: ExtractionPipeline
  readonly ingest: IngestService
  readonly graphBuilder: GraphBuilder
  /** 文件目录知识库：索引器与检索器 */
  readonly indexer: DocumentIndexer
  readonly docSearch: DocumentSearcher
  /** 主动记忆的准入把关 */
  readonly captureGate: CaptureGate
  /** 文件目录知识库的门面 */
  readonly library: KnowledgeLibrary
  private readonly extractor: MemoryExtractor

  private constructor(store: MyceliaStore, config: Config) {
    this.store = store
    this.config = config

    const parts = assembleService(store, config)
    this.embedder = parts.embedder
    this.llm = parts.llm
    this.retriever = parts.retriever
    this.ingest = parts.ingest
    this.graphBuilder = parts.graphBuilder
    this.indexer = parts.indexer
    this.docSearch = parts.docSearch
    this.library = parts.library
    this.captureGate = parts.captureGate
    this.extractor = parts.extractor
    this.pipeline = parts.pipeline
  }

  static open(opts: ServiceOptions = {}): MemoryService {
    const store = MyceliaStore.open({ dbPath: opts.dbPath, vaultPath: opts.vaultPath })
    const config = opts.config ?? store.config()
    return new MemoryService(store, config)
  }

  // ────────────────────────────── 检索 ──────────────────────────────

  async recall(query: Partial<SearchQuery> & { text?: string }): Promise<RetrievalResult> {
    return this.retriever.search({
      text: query.text ?? '',
      kinds: query.kinds,
      tags: query.tags,
      tagMode: query.tagMode ?? 'any',
      project: query.project,
      agent: query.agent,
      sensitivity: query.sensitivity,
      since: query.since,
      until: query.until,
      limit: query.limit ?? this.config.retrieval.defaultLimit,
      includeSecrets: query.includeSecrets ?? false,
      includePending: query.includePending ?? false,
      includeArchived: query.includeArchived ?? false,
      expandGraph: query.expandGraph ?? this.config.retrieval.graphExpansion,
    })
  }

  /** 找与某条记忆最相似的其他记忆 */
  similar(memoryId: string, limit = 8): StoredMemory[] {
    const vec = this.store.vectors.get(memoryId)
    if (!vec) return []
    const hits = this.store.vectors.search(vec, limit + 1, (id) => id !== memoryId)
    return this.store.memories.getMany(hits.map((h) => h.id))
  }

  // ────────────────────────────── 写入 ──────────────────────────────

  /** 直接写入一条记忆，不经准入把关（桌面端新建、导入流水线） */
  async remember(
    input: Omit<MemoryInput, 'origin'> & { origin?: Partial<MemoryInput['origin']> },
    actor = 'user',
  ): Promise<StoredMemory> {
    const memory = this.store.memories.insert(
      {
        ...input,
        summary: input.summary ?? truncate(input.content, 200),
        origin: {
          agent: (input.origin?.agent as AgentSource) ?? 'manual',
          sessionId: input.origin?.sessionId,
          cwd: input.origin?.cwd,
          project: input.origin?.project,
          branch: input.origin?.branch,
          messageIds: input.origin?.messageIds ?? [],
          excerpt: input.origin?.excerpt,
        },
        captureMode: input.captureMode ?? 'manual',
        embeddingModel: this.embedder.id,
      },
      actor,
    )

    await this.reindex(memory.id)
    return this.store.memories.get(memory.id)!
  }

  /**
   * agent 主动写入的入口 —— 这是记忆的**主路径**。
   *
   * 与 remember 的区别是它要过准入把关：agent 在对话里判断「这条值得记」，
   * 但它没有全局视野，判断不了这条内容是不是已经有了、够不够格长期留存。
   * 那部分判断在这里做，而不是信任调用方。
   */
  capture(
    candidate: CaptureCandidate,
    opts: CaptureOptions = {},
  ): Promise<{ decision: CaptureDecision; memory: StoredMemory | null }> {
    return runCapture(
      {
        gate: this.captureGate,
        remember: (input, actor) => this.remember(input, actor),
        update: (id, patch, actor) => this.update(id, patch, actor),
      },
      candidate,
      opts,
    )
  }

  // ──────────────────────── 文件目录知识库 ────────────────────────
  // 具体实现在 KnowledgeLibrary，这里只做转发，保持既有调用方不变

  searchDocuments(query: string, opts: DocumentSearchOptions = {}): Promise<DocumentHit[]> {
    return this.library.searchDocuments(query, opts)
  }

  addSource(input: { name: string; path: string; extensions?: string[] }): StoredSource {
    return this.library.addSource(input)
  }

  removeSource(id: string): boolean {
    return this.library.removeSource(id)
  }

  indexSource(id: string, opts: IndexOptions = {}): Promise<IndexResult> {
    return this.library.indexSource(id, opts)
  }

  indexAllSources(opts: IndexOptions = {}): Promise<IndexResult[]> {
    return this.library.indexAllSources(opts)
  }

  async update(id: string, patch: MemoryPatch, actor = 'user'): Promise<StoredMemory> {
    const updated = this.store.memories.update(id, patch, actor)
    // 正文变了就得重算向量与关联，否则检索会指向旧内容
    if (patch.content !== undefined || patch.title !== undefined) {
      await this.reindex(id)
    }
    return updated
  }

  forget(id: string, actor = 'user'): boolean {
    return this.store.memories.delete(id, actor)
  }

  /** 确认一条待定记忆 */
  accept(id: string): StoredMemory {
    return this.store.memories.update(id, { status: 'active' }, 'user:accept')
  }

  reject(id: string): boolean {
    return this.store.memories.delete(id, 'user:reject')
  }

  /** 重算某条记忆的向量与图谱边 */
  async reindex(id: string): Promise<void> {
    const m = this.store.memories.get(id)
    if (!m || m.locked) return
    try {
      const vec = await this.embedder.embedOne(`${m.title}\n${m.content}`)
      this.store.vectors.upsert(this.store.db, id, this.embedder.id, vec)
    } catch (e) {
      log.warn(`重新嵌入失败 ${id}：${String(e)}`)
    }
    this.graphBuilder.invalidateCache()
    this.graphBuilder.buildForMemories([id])
  }

  // ────────────────────────────── 流水线 ──────────────────────────────

  /** 摄取 + 提取的完整流程，daemon 与 CLI 都调它 */
  async sync(
    opts: PipelineOptions & { agents?: AgentSource[]; force?: boolean } = {},
  ): Promise<{ ingest: Awaited<ReturnType<IngestService['run']>>; pipeline: PipelineResult }> {
    const ingestResult = await this.ingest.run(this.config, {
      agents: opts.agents,
      force: opts.force,
      maxSources: opts.maxConversations,
    })

    const pipelineResult = await this.pipeline.run({
      ...opts,
      conversations: opts.conversations ?? ingestResult.conversations,
    })

    return { ingest: ingestResult, pipeline: pipelineResult }
  }

  // ────────────────────────────── 图谱 ──────────────────────────────

  graph(opts: SnapshotOptions = {}): GraphSnapshot {
    return buildSnapshot(this.store, this.config.graph, opts)
  }

  rebuildGraph(onProgress?: (done: number, total: number) => void) {
    this.graphBuilder.invalidateCache()
    return this.graphBuilder.rebuildAll(onProgress)
  }

  // ────────────────────────────── 汇总视图 ──────────────────────────────
  /** 生成时间段内的工作纪要 */
  digest(sinceMs: number, untilMs = Date.now()): Promise<string> {
    return generateDigest({ store: this.store, llm: this.llm }, sinceMs, untilMs)
  }

  /** 本周纪要 */
  weeklyDigest(): Promise<string> {
    return weeklyDigest({ store: this.store, llm: this.llm })
  }

  stats() {
    const sources = this.store.sources.all()
    return {
      memories: this.store.memories.stats(),
      conversations: this.store.conversations.stats(),
      health: this.store.health(),
      agents: this.ingest.availability(),
      knowledge: {
        sources: sources.length,
        documents: sources.reduce((sum, s) => sum + s.docCount, 0),
        chunks: this.store.chunks.count(),
      },
      embedder: { id: this.embedder.id, kind: this.embedder.kind, dims: this.embedder.dimensions },
      llm: { id: this.llm.id, model: this.llm.model, enabled: this.llm.enabled },
    }
  }

  close(): void {
    this.ingest.close()
    this.store.close()
  }
}

export type { MemoryKind, Sensitivity }
export { hashContent, newId }
