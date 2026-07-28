/**
 * 文档检索。
 *
 * 与记忆检索同构（向量 + 全文加权融合），但多了一步 small-to-big：
 * 命中的是小块（粒度细才能定位准），返回时把相邻块拼回去（上下文全才能用）。
 *
 * 这是对抗碎片化的最后一环。前面两环在 chunk.ts（沿结构切）和 context.ts
 * （补定位说明），到这里再把切开的东西还原成人能读的段落。
 */

import type { Embedder } from '@mycelia/embed'
import type { KnowledgeConfig, RetrievalConfig } from '@mycelia/shared'
import { createLogger } from '@mycelia/shared'
import type { MyceliaStore, StoredChunk, StoredDocument, StoredSource } from '@mycelia/store'

const log = createLogger('core:knowledge:search')

export interface DocumentHit {
  chunkId: string
  documentId: string
  sourceId: string
  score: number
  breakdown: { vector: number; keyword: number }
  /** 命中块原文 */
  content: string
  /** 命中块 + 邻居拼成的完整上下文，UI 与 MCP 返回的是它 */
  context: string
  heading: string
  document: { title: string; relPath: string; absPath: string }
  source: { id: string; name: string }
}

export interface DocumentSearchOptions {
  limit?: number
  /** 限定在这些知识源内检索 */
  sourceIds?: string[]
  /** small-to-big 的扩展半径，0 表示只返回命中块本身 */
  neighborRadius?: number
}

export class DocumentSearcher {
  constructor(
    private readonly store: MyceliaStore,
    private readonly embedder: Embedder,
    private readonly retrieval: RetrievalConfig,
    private readonly knowledge: KnowledgeConfig,
  ) {}

  async search(query: string, opts: DocumentSearchOptions = {}): Promise<DocumentHit[]> {
    const text = query.trim()
    if (!text) return []
    if (this.store.chunks.count() === 0) return []

    const limit = opts.limit ?? this.retrieval.defaultLimit
    const poolSize = Math.max(limit * 4, 32)
    const scores = new Map<string, { vector: number; keyword: number }>()

    const scope = opts.sourceIds?.length ? new Set(opts.sourceIds) : null
    const allowed = scope
      ? (chunkId: string) => {
          const chunk = this.store.chunks.get(chunkId)
          return chunk ? scope.has(chunk.sourceId) : false
        }
      : undefined

    // ── 向量通道 ──
    try {
      const qvec = await this.embedder.embedOne(text)
      for (const hit of this.store.chunkVectors.search(qvec, poolSize, allowed)) {
        const entry = scores.get(hit.id) ?? { vector: 0, keyword: 0 }
        entry.vector = Math.max(entry.vector, hit.score * this.retrieval.vectorWeight)
        scores.set(hit.id, entry)
      }
    } catch (e) {
      log.warn(`文档向量检索失败，仅用关键词：${String(e)}`)
    }

    // ── 全文通道：专有名词、命令、报错信息靠它兜住 ──
    for (const hit of this.store.chunks.search(text, poolSize, opts.sourceIds)) {
      const entry = scores.get(hit.id) ?? { vector: 0, keyword: 0 }
      entry.keyword = Math.max(entry.keyword, hit.score * this.retrieval.keywordWeight)
      scores.set(hit.id, entry)
    }

    if (scores.size === 0) return []

    const ranked = [...scores.entries()]
      .map(([chunkId, breakdown]) => ({
        chunkId,
        breakdown,
        score: (breakdown.vector + breakdown.keyword) * this.knowledge.weight,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    const chunks = this.store.chunks.getMany(ranked.map((r) => r.chunkId))
    const chunkById = new Map(chunks.map((c) => [c.id, c]))
    const documents = new Map<string, StoredDocument>()
    const sources = new Map<string, StoredSource>()

    const radius = opts.neighborRadius ?? 1
    const hits: DocumentHit[] = []

    for (const entry of ranked) {
      const chunk = chunkById.get(entry.chunkId)
      if (!chunk) continue

      let document = documents.get(chunk.documentId)
      if (!document) {
        const found = this.store.documents.get(chunk.documentId)
        if (!found) continue
        document = found
        documents.set(chunk.documentId, found)
      }

      let source = sources.get(chunk.sourceId)
      if (!source) {
        const found = this.store.sources.get(chunk.sourceId)
        if (!found) continue
        source = found
        sources.set(chunk.sourceId, found)
      }

      hits.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        sourceId: chunk.sourceId,
        score: entry.score,
        breakdown: entry.breakdown,
        content: chunk.content,
        context: radius > 0 ? this.expand(chunk, radius) : chunk.content,
        heading: chunk.heading,
        document: {
          title: document.title,
          relPath: document.relPath,
          absPath: document.absPath,
        },
        source: { id: source.id, name: source.name },
      })
    }

    return hits
  }

  /** small-to-big：把命中块与前后邻居拼成连续段落 */
  private expand(chunk: StoredChunk, radius: number): string {
    const neighbors = this.store.chunks.withNeighbors(chunk.id, radius)
    if (neighbors.length <= 1) return chunk.content
    return neighbors.map((c) => c.content).join('\n\n')
  }

  /** 取整篇文档的全部块，用于「查看原文」 */
  documentText(documentId: string): string {
    return this.store.chunks
      .byDocument(documentId)
      .map((c) => c.content)
      .join('\n\n')
  }
}
