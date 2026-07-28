import type { Embedder } from '@mycelia/embed'
import type { RetrievalConfig, SearchHit, SearchQuery } from '@mycelia/shared'
import { createLogger, DAY_MS } from '@mycelia/shared'
import type { MyceliaStore, StoredMemory } from '@mycelia/store'

const log = createLogger('core:retrieval')

/** 时间衰减半衰期：60 天前的记忆，新鲜度加成减半 */
const RECENCY_HALFLIFE_MS = 60 * DAY_MS

export interface RetrievalResult {
  hits: SearchHit[]
  memories: StoredMemory[]
  /** 实际用了哪些检索通道，UI 上可以解释 */
  channels: { vector: number; keyword: number; graph: number }
  durationMs: number
}

/**
 * 混合检索。
 *
 * 为什么不只用向量：技术知识库里大量查询是精确的 —— 「server-hk-01 的密码」、
 * 「pnpm-workspace.yaml 怎么配」。向量对专有名词和罕见标识符很不敏感，
 * 而 BM25 正好相反。两者互补，缺一不可。
 *
 * 为什么加图扩散：用户问「香港服务器」，最相关的是那条 SSH 记忆，
 * 但真正有用的往往还包括「那台机器上跑着什么服务」—— 这条记忆
 * 文本上跟查询毫无重合，只能靠图谱把它带出来。
 */
export class Retriever {
  constructor(
    private readonly store: MyceliaStore,
    private readonly embedder: Embedder,
    private readonly config: RetrievalConfig,
  ) {}

  async search(query: SearchQuery): Promise<RetrievalResult> {
    const started = Date.now()
    const limit = query.limit ?? this.config.defaultLimit

    // 候选池开得比 limit 大：融合与重排之后才截断
    const poolSize = Math.max(limit * 4, 40)
    const scores = new Map<string, SearchHit>()
    const channels = { vector: 0, keyword: 0, graph: 0 }

    const allowed = this.buildFilter(query)

    // ── 通道 1：向量语义 ──
    if (query.text.trim()) {
      try {
        const qvec = await this.embedder.embedOne(query.text)
        const vectorHits = this.store.vectors.search(qvec, poolSize, allowed)
        channels.vector = vectorHits.length
        for (const h of vectorHits) {
          upsertHit(scores, h.id, { vector: h.score * this.config.vectorWeight })
        }
      } catch (e) {
        log.warn(`向量检索失败，仅用关键词：${String(e)}`)
      }

      // ── 通道 2：全文关键词 ──
      const ftsHits = this.store.memories.fullTextSearch(query.text, poolSize)
      channels.keyword = ftsHits.length
      for (const h of ftsHits) {
        if (!allowed(h.id)) continue
        upsertHit(scores, h.id, { keyword: h.score * this.config.keywordWeight }, h.snippet)
      }
    } else {
      // 空查询 = 浏览模式：按过滤条件列出，靠重要度和时间排序
      for (const m of this.store.memories.list({
        kinds: query.kinds,
        tags: query.tags,
        tagMode: query.tagMode,
        project: query.project,
        agent: query.agent,
        since: query.since,
        until: query.until,
        status: this.statusFilter(query),
        limit: poolSize,
        orderBy: 'importance',
      })) {
        upsertHit(scores, m.id, { vector: 0.5 })
      }
    }

    // ── 通道 3：图谱扩散 ──
    if ((query.expandGraph ?? this.config.graphExpansion) && scores.size > 0) {
      const seeds = [...scores.entries()]
        .sort((a, b) => sum(b[1].breakdown) - sum(a[1].breakdown))
        .slice(0, 5)

      for (const [seedId, seedHit] of seeds) {
        const seedScore = sum(seedHit.breakdown)
        for (const edge of this.store.edges.neighbors(seedId, 6)) {
          const neighborId = edge.sourceId === seedId ? edge.targetId : edge.sourceId
          if (scores.has(neighborId) || !allowed(neighborId)) continue
          // 扩散来的结果打五折，它是「相关的相关」，不该压过直接命中
          const graphScore = seedScore * edge.weight * 0.5
          if (graphScore < 0.08) continue
          channels.graph++
          upsertHit(scores, neighborId, { graph: graphScore }, undefined, seedId)
        }
      }
    }

    if (scores.size === 0) {
      return { hits: [], memories: [], channels, durationMs: Date.now() - started }
    }

    // ── 重排：叠加重要度与新鲜度 ──
    const memories = this.store.memories.getMany([...scores.keys()], {
      decrypt: query.includeSecrets ?? false,
    })
    const memoryById = new Map(memories.map((m) => [m.id, m]))
    const now = Date.now()

    for (const [id, hit] of scores) {
      const m = memoryById.get(id)
      if (!m) {
        scores.delete(id)
        continue
      }
      // 重要度与置顶：用户手动标记的东西必须优先浮上来
      hit.breakdown.importance = m.importance * 0.2 + (m.pinned ? 0.25 : 0)
      // 新鲜度：指数衰减，最多贡献 0.15
      const age = now - m.updatedAt
      hit.breakdown.recency = 0.15 * Math.exp(-age / RECENCY_HALFLIFE_MS)
      hit.score = sum(hit.breakdown)
      if (!hit.snippet) hit.snippet = makeSnippet(m, query.text)
    }

    const ranked = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    const rankedMemories = ranked
      .map((h) => memoryById.get(h.memoryId))
      .filter((m): m is StoredMemory => Boolean(m))

    // 记录召回，反哺后续排序，也是「哪些记忆真正在被用」的统计来源
    this.store.memories.recordRecall(ranked.map((h) => h.memoryId))

    return {
      hits: ranked,
      memories: rankedMemories,
      channels,
      durationMs: Date.now() - started,
    }
  }

  /**
   * 构建候选过滤器。
   * 在算分之前就把不符合条件的排除掉，而不是算完再筛 ——
   * 全库几万条时这个差别很明显。
   */
  private buildFilter(query: SearchQuery): (id: string) => boolean {
    const needsFilter =
      query.kinds?.length ||
      query.tags?.length ||
      query.project ||
      query.agent ||
      query.since ||
      query.until ||
      !query.includeSecrets

    if (!needsFilter) {
      const activeIds = new Set(
        this.store.memories
          .list({ status: this.statusFilter(query), limit: 100_000 })
          .map((m) => m.id),
      )
      return (id) => activeIds.has(id)
    }

    const allowedIds = new Set(
      this.store.memories
        .list({
          kinds: query.kinds,
          tags: query.tags,
          tagMode: query.tagMode,
          project: query.project,
          agent: query.agent,
          since: query.since,
          until: query.until,
          sensitivity: query.includeSecrets ? undefined : ['public', 'private'],
          status: this.statusFilter(query),
          limit: 100_000,
        })
        .map((m) => m.id),
    )
    return (id) => allowedIds.has(id)
  }

  private statusFilter(query: SearchQuery): string[] {
    const status = ['active']
    if (query.includePending) status.push('pending')
    if (query.includeArchived) status.push('archived')
    return status
  }
}

function upsertHit(
  scores: Map<string, SearchHit>,
  id: string,
  delta: Partial<SearchHit['breakdown']>,
  snippet?: string,
  viaMemoryId?: string,
) {
  const existing = scores.get(id)
  if (existing) {
    for (const [k, v] of Object.entries(delta)) {
      const key = k as keyof SearchHit['breakdown']
      existing.breakdown[key] = Math.max(existing.breakdown[key], v as number)
    }
    if (snippet && !existing.snippet) existing.snippet = snippet
    existing.score = sum(existing.breakdown)
    return
  }
  const breakdown = { vector: 0, keyword: 0, recency: 0, importance: 0, graph: 0, ...delta }
  scores.set(id, {
    memoryId: id,
    score: sum(breakdown),
    breakdown,
    snippet: snippet ?? '',
    viaMemoryId,
  })
}

function sum(b: SearchHit['breakdown']): number {
  return b.vector + b.keyword + b.recency + b.importance + b.graph
}

/** 生成带高亮的摘要片段 */
function makeSnippet(m: StoredMemory, query: string): string {
  const text = m.summary || m.content
  if (!query.trim()) return text.slice(0, 160)

  const terms = query.split(/\s+/).filter((t) => t.length >= 2)
  for (const term of terms) {
    const idx = text.toLowerCase().indexOf(term.toLowerCase())
    if (idx === -1) continue
    const start = Math.max(0, idx - 50)
    const end = Math.min(text.length, idx + term.length + 110)
    const slice = text.slice(start, end)
    const highlighted = slice.replace(
      new RegExp(escapeRegExp(term), 'gi'),
      (match) => `<mark>${match}</mark>`,
    )
    return `${start > 0 ? '…' : ''}${highlighted}${end < text.length ? '…' : ''}`
  }
  return text.slice(0, 160)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
