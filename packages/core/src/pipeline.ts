import type { Embedder } from '@mycelia/embed'
import type { Config, Conversation, MemoryInput } from '@mycelia/shared'
import { createLogger, hashContent, mapLimit } from '@mycelia/shared'
import type { MyceliaStore, StoredMemory } from '@mycelia/store'
import type { MemoryExtractor } from './extract/index.js'
import type { ExtractedMemory } from './extract/types.js'
import { GraphBuilder } from './graph/build.js'

const log = createLogger('core:pipeline')

export interface PipelineResult {
  processedConversations: number
  createdMemories: number
  mergedMemories: number
  pendingMemories: number
  skippedConversations: number
  edgesCreated: number
  llmCalls: number
  tokensUsed: number
  errors: string[]
  durationMs: number
}

export interface PipelineOptions {
  /** 只处理这些会话；不传则取所有未处理的 */
  conversations?: Conversation[]
  maxConversations?: number
  /** 进度回调，桌面端用它画进度条 */
  onProgress?: (done: number, total: number, current: string) => void
  signal?: AbortSignal
}

/**
 * 提取流水线：会话 → 记忆 → 向量 → 实体 → 图谱边。
 *
 * 每个会话独立处理并立即落库，而不是全部提取完再统一写入 ——
 * 中途被用户取消或进程被杀时，已完成的部分不会白干。
 */
export class ExtractionPipeline {
  private readonly graphBuilder: GraphBuilder

  constructor(
    private readonly store: MyceliaStore,
    private readonly extractor: MemoryExtractor,
    private readonly embedder: Embedder,
    private readonly config: Config,
  ) {
    this.graphBuilder = new GraphBuilder(store, config.graph)
  }

  async run(opts: PipelineOptions = {}): Promise<PipelineResult> {
    const started = Date.now()
    const result: PipelineResult = {
      processedConversations: 0,
      createdMemories: 0,
      mergedMemories: 0,
      pendingMemories: 0,
      skippedConversations: 0,
      edgesCreated: 0,
      llmCalls: 0,
      tokensUsed: 0,
      errors: [],
      durationMs: 0,
    }

    const conversations = opts.conversations ?? []
    const total = conversations.length
    const newMemoryIds: string[] = []

    for (let i = 0; i < conversations.length; i++) {
      if (opts.signal?.aborted) {
        log.info('流水线被取消')
        break
      }
      const conv = conversations[i]!
      opts.onProgress?.(i, total, conv.title)

      // 太短的对话不值得烧一次 LLM 调用
      if (conv.messages.length < this.config.ingest.minMessages) {
        result.skippedConversations++
        this.store.conversations.markProcessed(conv.id, 0)
        continue
      }
      if (this.store.conversations.isProcessed(conv.id, conv.endedAt)) {
        result.skippedConversations++
        continue
      }

      try {
        const outcome = await this.extractor.extract(conv)
        if (outcome.method === 'llm') {
          result.llmCalls++
          result.tokensUsed += (outcome.inputTokens ?? 0) + (outcome.outputTokens ?? 0)
        }
        if (outcome.error) result.errors.push(`${conv.id}: ${outcome.error}`)

        const ids = await this.persist(conv, outcome.memories, result)
        newMemoryIds.push(...ids)

        this.store.conversations.markProcessed(conv.id, ids.length)
        result.processedConversations++
      } catch (e) {
        const msg = `会话 ${conv.id} 处理失败：${String(e instanceof Error ? e.message : e)}`
        log.warn(msg)
        result.errors.push(msg)
      }
    }

    // 边的构建放到最后统一做：新记忆之间也可能互相关联，
    // 逐条构建会漏掉「后来的记忆与更早的新记忆」这种关系
    if (newMemoryIds.length > 0) {
      this.graphBuilder.invalidateCache()
      const edgeResult = this.graphBuilder.buildForMemories(newMemoryIds)
      result.edgesCreated = edgeResult.created
    }

    opts.onProgress?.(total, total, '完成')
    result.durationMs = Date.now() - started
    log.info(
      `流水线完成：${result.processedConversations} 个会话 → 新增 ${result.createdMemories} 条 / 合并 ${result.mergedMemories} 条 / 待确认 ${result.pendingMemories} 条，${result.edgesCreated} 条边`,
    )
    return result
  }

  /** 落库单个会话提取出的记忆，处理去重与合并 */
  private async persist(
    conv: Conversation,
    extracted: readonly ExtractedMemory[],
    result: PipelineResult,
  ): Promise<string[]> {
    if (extracted.length === 0) return []

    // 先批量算向量：去重要用它，后面落库也要用
    const vectors = await this.embed(extracted.map((m) => `${m.title}\n${m.content}`))
    const created: string[] = []

    for (let i = 0; i < extracted.length; i++) {
      const mem = extracted[i]!
      const vec = vectors[i]

      const dup = this.findDuplicate(mem, vec)
      if (dup) {
        this.merge(dup, mem, conv)
        result.mergedMemories++
        continue
      }

      const autoAccept = mem.confidence >= this.config.extraction.autoAcceptThreshold
      const input: MemoryInput = {
        kind: mem.kind,
        title: mem.title,
        content: mem.content,
        summary: mem.content.slice(0, 200),
        tags: mem.tags,
        sensitivity: mem.sensitivity,
        status: autoAccept ? 'active' : 'pending',
        confidence: mem.confidence,
        importance: mem.importance,
        pinned: false,
        origin: {
          agent: conv.agent,
          sessionId: conv.sessionId,
          cwd: conv.cwd,
          project: conv.project,
          branch: conv.branch,
          messageIds: mem.sourceMessageIds,
          excerpt: conv.title,
        },
        embeddingModel: this.embedder.id,
      }

      let stored: StoredMemory
      try {
        stored = this.store.memories.insert(input, `extract:${conv.agent}`)
      } catch (e) {
        // secret 记忆在保险箱上锁时无法写入 —— 这是预期行为，不是 bug。
        // 转存为待确认的 private 记忆，内容已由提取器抹去密钥。
        if (mem.sensitivity === 'secret' && !this.store.vault.unlocked) {
          log.warn(`保险箱未解锁，「${mem.title}」暂存为待确认记忆`)
          stored = this.store.memories.insert(
            {
              ...input,
              kind: 'fact',
              sensitivity: 'private',
              status: 'pending',
              content: `[原为敏感记忆，保险箱未解锁时写入]\n\n${mem.title}`,
            },
            `extract:${conv.agent}`,
          )
        } else {
          throw e
        }
      }

      if (vec) this.store.vectors.upsert(this.store.db, stored.id, this.embedder.id, vec)
      this.linkEntities(stored.id, mem)

      created.push(stored.id)
      if (autoAccept) result.createdMemories++
      else result.pendingMemories++
    }

    return created
  }

  /**
   * 查重。
   * 两道关卡：内容哈希完全一致（同一条记忆被重复提取），
   * 或语义相似度超过阈值且类型相同（换了个说法的同一件事）。
   */
  private findDuplicate(mem: ExtractedMemory, vec?: Float32Array): StoredMemory | undefined {
    const exact = this.store.memories.findByHash(hashContent(mem.kind, mem.title, mem.content))
    if (exact) return exact

    if (!vec) return undefined
    const similar = this.store.vectors.search(vec, 3)
    for (const s of similar) {
      if (s.score < this.config.extraction.dedupeThreshold) break
      const candidate = this.store.memories.get(s.id, { decrypt: false })
      if (candidate && candidate.kind === mem.kind) return candidate
    }
    return undefined
  }

  /**
   * 合并重复记忆。
   *
   * 不是简单覆盖 —— 重复出现本身就是信号：这件事被反复提到，说明它重要。
   * 所以提升重要度，并把新来源追加进去，正文取更详细的那个版本。
   */
  private merge(existing: StoredMemory, incoming: ExtractedMemory, conv: Conversation): void {
    const mergedTags = [...new Set([...existing.tags, ...incoming.tags])]
    const useIncomingContent = incoming.content.length > existing.content.length * 1.2

    this.store.memories.update(
      existing.id,
      {
        tags: mergedTags,
        importance: Math.min(1, existing.importance + 0.08),
        confidence: Math.max(existing.confidence, incoming.confidence),
        ...(useIncomingContent ? { content: incoming.content } : {}),
        // 敏感度只升不降
        ...(incoming.sensitivity === 'secret' ? { sensitivity: 'secret' as const } : {}),
      },
      `merge:${conv.agent}`,
    )
    this.linkEntities(existing.id, incoming)
  }

  private linkEntities(memoryId: string, mem: ExtractedMemory): void {
    for (const e of mem.entities) {
      try {
        const entity = this.store.entities.upsert(e.kind, e.name)
        this.store.entities.link(memoryId, entity.id)
      } catch (err) {
        log.debug(`实体写入失败 ${e.name}：${String(err)}`)
      }
    }
  }

  private async embed(texts: string[]): Promise<Array<Float32Array | undefined>> {
    try {
      return await this.embedder.embed(texts)
    } catch (e) {
      log.warn(`批量嵌入失败，本批记忆暂无向量：${String(e)}`)
      return texts.map(() => undefined)
    }
  }

  /** 补齐所有缺失的向量 —— 换嵌入模型后调用 */
  async backfillEmbeddings(onProgress?: (done: number, total: number) => void): Promise<number> {
    let done = 0
    for (;;) {
      const batch = this.store.memories.needsEmbedding(this.embedder.id, 64)
      if (batch.length === 0) break

      const vectors = await mapLimit(batch, 4, async (m) => {
        try {
          return await this.embedder.embedOne(`${m.title}\n${m.content}`)
        } catch {
          return undefined
        }
      })

      for (let i = 0; i < batch.length; i++) {
        const v = vectors[i]
        if (v) this.store.vectors.upsert(this.store.db, batch[i]!.id, this.embedder.id, v)
      }
      done += batch.length
      onProgress?.(done, done + 1)
    }
    return done
  }
}
