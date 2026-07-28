import type { EdgeInput, GraphConfig } from '@mycelia/shared'
import { createLogger } from '@mycelia/shared'
import type { MyceliaStore, StoredMemory } from '@mycelia/store'
import { dot } from '@mycelia/store'

const log = createLogger('core:graph')

/** 每个节点最多保留多少条自动生成的边 —— 控制图的稠密度 */
const EDGE_BUDGET_PER_NODE = 12

export interface BuildEdgesResult {
  created: number
  scanned: number
  durationMs: number
}

/**
 * 边生成。
 *
 * 图谱好不好看、有没有信息量，全在这里。核心矛盾是：
 * 边太少 → 一盘散沙，看不出关联；边太多 → 一团毛线，同样看不出关联。
 *
 * 解法是给每个节点设边预算，多种边源竞争这个预算：
 *   语义相似 > 共享实体 > 共享标签 > 同会话 > 同项目
 * 强关系优先占坑，弱关系只在还有余量时补位。
 */
export class GraphBuilder {
  constructor(
    private readonly store: MyceliaStore,
    private readonly config: GraphConfig,
  ) {}

  /**
   * 为指定记忆重建边（增量）。
   * 新记忆入库后调用，只算它与全库的关系，不动其他节点已有的边。
   */
  buildForMemories(memoryIds: readonly string[]): BuildEdgesResult {
    const started = Date.now()
    const edges: EdgeInput[] = []

    for (const id of memoryIds) {
      const memory = this.store.memories.get(id, { decrypt: false })
      if (!memory) continue
      // 先清掉这条记忆的旧自动边，避免内容改了但陈旧关联还挂着
      this.store.edges.removeAutoEdgesFor(id)
      edges.push(...this.edgesFor(memory))
    }

    const created = this.store.edges.upsertMany(edges)
    return { created, scanned: memoryIds.length, durationMs: Date.now() - started }
  }

  /** 全量重建。记忆数大时较慢，应该放到后台任务里跑 */
  rebuildAll(onProgress?: (done: number, total: number) => void): BuildEdgesResult {
    const started = Date.now()
    const all = this.store.memories.list({
      status: ['active'],
      limit: 100_000,
    })

    this.store.db.exec(
      "DELETE FROM edges WHERE kind IN ('semantic','tag','session','project','entity')",
    )

    const edges: EdgeInput[] = []
    for (let i = 0; i < all.length; i++) {
      edges.push(...this.edgesFor(all[i]!))
      if (onProgress && i % 100 === 0) onProgress(i, all.length)
    }

    const created = this.store.edges.upsertMany(edges)
    const durationMs = Date.now() - started
    log.info(`图谱重建完成：${all.length} 个节点，${created} 条边，耗时 ${durationMs}ms`)
    return { created, scanned: all.length, durationMs }
  }

  /** 单个节点的边 —— 多来源竞争边预算 */
  private edgesFor(memory: StoredMemory): EdgeInput[] {
    const candidates: Array<EdgeInput & { priority: number }> = []

    // 1. 语义相似（最强信号）
    const vec = this.store.vectors.get(memory.id)
    if (vec) {
      const neighbors = this.store.vectors.search(
        vec,
        this.config.semanticNeighbors + 1,
        (id) => id !== memory.id,
      )
      for (const n of neighbors) {
        if (n.score < this.config.semanticThreshold) continue
        candidates.push({
          sourceId: memory.id,
          targetId: n.id,
          kind: 'semantic',
          weight: n.score,
          reason: `语义相似度 ${(n.score * 100).toFixed(0)}%`,
          priority: 100 + n.score * 10,
        })
      }
    }

    // 2. 共享实体（第二强：都提到同一台服务器几乎必然相关）
    const entities = this.store.entities.entitiesOf(memory.id)
    for (const entity of entities) {
      // 提及次数太多的实体（比如「项目」这种泛化概念）不产生边，否则全连成一团
      if (entity.mentionCount > 30) continue
      const siblings = this.store.entities.memoriesOf(entity.id)
      for (const sib of siblings) {
        if (sib === memory.id) continue
        candidates.push({
          sourceId: memory.id,
          targetId: sib,
          kind: 'entity',
          // 越稀有的实体，共享它的两条记忆关系越紧密
          weight: Math.min(0.95, 1 / Math.log2(entity.mentionCount + 2) + 0.3),
          reason: `都涉及 ${entity.name}`,
          priority: 80,
        })
      }
    }

    // 3. 共享标签（弱信号，用 IDF 加权）
    if (memory.tags.length > 0) {
      const tagCounts = this.tagCounts()
      const total = this.totalMemories()
      for (const tag of memory.tags) {
        const count = tagCounts.get(tag) ?? 1
        // 一个标签下上百条记忆，共享它说明不了什么
        if (count > 25 || count < 2) continue
        const idf = Math.log(total / count) / Math.log(total)
        // 每个标签最多牵出 4 条边。放开限制的话，一个 user/preference 标签
        // 就能把十几条毫不相干的记忆两两连起来，图上全是同权重的假关联，
        // 真正有意义的语义边和实体边反而被挤出预算。
        const peers = this.store.memories.list({ tags: [tag], limit: 5, orderBy: 'importance' })
        for (const peer of peers) {
          if (peer.id === memory.id) continue
          candidates.push({
            sourceId: memory.id,
            targetId: peer.id,
            kind: 'tag',
            // 标签共现是三类关系里最弱的信号，权重压在语义边之下
            weight: Math.min(0.45, idf * 0.6),
            reason: `同属标签 ${tag}`,
            priority: 40 + idf * 5,
          })
        }
      }
    }

    // 4. 同会话共现（时序关联：一次对话里产出的记忆天然有上下文关系）
    const sessionId = memory.origin.sessionId
    if (sessionId) {
      const siblings = this.store.db
        .prepare(`
          SELECT id FROM memories
          WHERE json_extract(origin, '$.sessionId') = ? AND id != ? AND status = 'active'
          LIMIT 10
        `)
        .all(sessionId, memory.id) as Array<{ id: string }>
      for (const s of siblings) {
        candidates.push({
          sourceId: memory.id,
          targetId: s.id,
          kind: 'session',
          weight: 0.45,
          reason: '来自同一次对话',
          priority: 30,
        })
      }
    }

    // 5. 同项目的时间邻接边。
    // 项目只是结构背景，不代表两条记忆语义相同，所以只连接创建时间最近的 3 条，
    // 不做全量两两连接。这样既能让同一项目形成连续骨架，又不会把图变成毛线团。
    const project = memory.origin.project?.trim()
    if (project) {
      const peers = this.store.db
        .prepare(`
          SELECT id, ABS(created_at - ?) AS distance
          FROM memories
          WHERE json_extract(origin, '$.project') = ?
            AND id != ?
            AND status = 'active'
          ORDER BY distance ASC, importance DESC
          LIMIT 3
        `)
        .all(memory.createdAt, project, memory.id) as Array<{ id: string; distance: number }>
      for (const peer of peers) {
        const daysApart = peer.distance / (24 * 60 * 60 * 1000)
        candidates.push({
          sourceId: memory.id,
          targetId: peer.id,
          kind: 'project',
          weight: Math.max(0.16, 0.28 - Math.min(daysApart, 30) * 0.004),
          reason: `同属项目 ${project}`,
          priority: 20,
        })
      }
    }

    // 按优先级排序后截断到预算内，并去重（同一对节点只保留最强的那条边）
    candidates.sort((a, b) => b.priority - a.priority)
    const seen = new Set<string>()
    const out: EdgeInput[] = []
    for (const c of candidates) {
      if (out.length >= EDGE_BUDGET_PER_NODE) break
      const pairKey = [c.sourceId, c.targetId].sort().join('|')
      if (seen.has(pairKey)) continue
      seen.add(pairKey)
      const { priority: _priority, ...edge } = c
      out.push(edge)
    }
    return out
  }

  // 标签计数在一次构建过程中是稳定的，缓存起来避免每个节点都查一遍库
  private tagCountCache: Map<string, number> | null = null
  private totalCache = 0

  private tagCounts(): Map<string, number> {
    if (!this.tagCountCache) {
      this.tagCountCache = new Map(this.store.tags.usage().map((t) => [t.tag, t.count]))
    }
    return this.tagCountCache
  }

  private totalMemories(): number {
    if (!this.totalCache) {
      this.totalCache = Math.max(1, this.store.memories.count({ status: ['active'] }))
    }
    return this.totalCache
  }

  /** 缓存失效 —— 大批量写入记忆后调用 */
  invalidateCache(): void {
    this.tagCountCache = null
    this.totalCache = 0
  }
}

/** 两条记忆的相似度，供「找相似」功能直接调用 */
export function similarity(store: MyceliaStore, aId: string, bId: string): number {
  const a = store.vectors.get(aId)
  const b = store.vectors.get(bId)
  if (!a || !b) return 0
  return dot(a, b)
}
