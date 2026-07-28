/**
 * 记忆的检索、读取与写入。
 */

import type { MemoryService } from '@mycelia/core'
import { createLogger } from '@mycelia/shared'
import type { MemoryDetail, MyceliaApi } from '../../shared/ipc-contract.js'
import { broadcast, type Handle } from './registry.js'

const log = createLogger('main:ipc:memory')

export function registerMemoryHandlers(handle: Handle, service: MemoryService): void {
  // ─────────────────────── 检索与读取 ───────────────────────

  handle('recall', async (query: Partial<Parameters<MemoryService['recall']>[0]>) => {
    const result = await service.recall(query ?? {})
    return {
      memories: result.memories,
      hits: result.hits,
      channels: result.channels,
      durationMs: result.durationMs,
    }
  })

  handle('listMemories', (filter: Parameters<typeof service.store.memories.list>[0]) => {
    const memories = service.store.memories.list(filter ?? {})
    const total = service.store.memories.count(filter ?? {})
    return { memories, total }
  })

  handle('getMemory', (id: string): MemoryDetail | null => {
    const memory = service.store.memories.get(id)
    if (!memory) return null

    const neighbors = service.store.edges
      .neighbors(id, 12)
      .map((e) => {
        const otherId = e.sourceId === id ? e.targetId : e.sourceId
        const other = service.store.memories.get(otherId, { decrypt: false })
        return other ? { memory: other, weight: e.weight, kind: e.kind, reason: e.reason } : null
      })
      .filter((n): n is NonNullable<typeof n> => n !== null)

    return {
      memory,
      neighbors,
      entities: service.store.entities.entitiesOf(id).map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        mentionCount: e.mentionCount,
      })),
      audit: service.store
        .auditLog(20, id)
        .map((a) => ({ at: a.at, actor: a.actor, action: a.action, detail: a.detail })),
    }
  })
  handle('getGraph', (opts: Parameters<MemoryService['graph']>[0]) => service.graph(opts ?? {}))

  /** 已用过的标签及其频次。用于写入时的候选，越常用的排越前 */
  handle('listTags', () => service.store.tags.usage())

  handle('saveGraphLayout', (points: ReadonlyArray<{ id: string; x: number; y: number }>) => {
    service.store.layout.save(new Map(points.map((p) => [p.id, { x: p.x, y: p.y }])))
  })

  handle('resetGraphLayout', () => {
    service.store.layout.clear()
  })

  /**
   * 图内节点搜索。
   *
   * 必须查全库而不是当前画出来的那些：一万条记忆的库里视图只放得下
   * 一千多个节点，只搜视图等于只搜了 12% —— 而搜索恰恰是大库里
   * 唯一还能用的导航方式。命中不在视图里的节点时，前端会以它为中心重取图。
   */
  handle('searchGraphNodes', (text: string, limit = 30) => {
    const needle = text.trim()
    if (!needle) return []

    /**
     * 匹配下推到 SQLite，不要「先取一批再用 JS 过滤」。
     *
     * 上一版是 list({limit: 2000}) 之后在内存里 filter，看着像全库搜索，
     * 其实只搜了重要度最高的那 2000 条 —— 一万条库里搜「压测节点 4242」
     * 返回空，而它明明存在。用户会认为搜索坏了，实际是搜索范围悄悄被截断了。
     */
    const hits = service.store.memories.fullTextSearch(needle, limit * 3)
    const byRank = service.store.memories
      .getMany(hits.map((hit) => hit.id))
      .filter((m) => m.status === 'active' || m.status === 'pending')

    // FTS 命中的是全文，但节点上显示的是标题；标题直接匹配的排在前面
    const lower = needle.toLowerCase()
    const inTitle = byRank.filter((m) => m.title.toLowerCase().includes(lower))
    const rest = byRank.filter((m) => !m.title.toLowerCase().includes(lower))

    return [...inTitle, ...rest]
      .slice(0, limit)
      .map((m) => ({ id: m.id, label: m.title, kind: m.kind }))
  })
  handle('getTags', () => service.store.tags.usage())
  handle('getEntities', () =>
    service.store.entities.all(1).map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      mentionCount: e.mentionCount,
    })),
  )

  // ─────────────────────── 写入 ───────────────────────

  handle('createMemory', async (input: Parameters<MyceliaApi['createMemory']>[0]) => {
    const { project, ...memoryInput } = input
    const memory = await service.remember(
      {
        ...memoryInput,
        confidence: 1,
        status: 'active',
        origin: { agent: 'manual', project, messageIds: [] },
      },
      'desktop',
    )
    broadcast({ type: 'memories:changed' })
    return memory
  })

  handle('updateMemory', async (id: string, patch: Parameters<MemoryService['update']>[1]) => {
    const memory = await service.update(id, patch, 'desktop')
    broadcast({ type: 'memories:changed' })
    return memory
  })

  handle('deleteMemory', (id: string) => {
    const ok = service.forget(id, 'desktop')
    broadcast({ type: 'memories:changed' })
    return ok
  })

  handle('acceptMemory', (id: string) => {
    const m = service.accept(id)
    broadcast({ type: 'memories:changed' })
    return m
  })

  handle('rejectMemory', (id: string) => {
    const ok = service.reject(id)
    broadcast({ type: 'memories:changed' })
    return ok
  })

  handle('bulkAction', (ids: string[], action: string) => {
    let n = 0
    for (const id of ids) {
      try {
        switch (action) {
          case 'accept':
            service.accept(id)
            break
          case 'reject':
            service.reject(id)
            break
          case 'archive':
            service.store.memories.update(id, { status: 'archived' }, 'desktop')
            break
          case 'pin':
            service.store.memories.update(id, { pinned: true }, 'desktop')
            break
          case 'unpin':
            service.store.memories.update(id, { pinned: false }, 'desktop')
            break
          default:
            continue
        }
        n++
      } catch (e) {
        log.warn(`批量操作失败 ${id}：${String(e)}`)
      }
    }
    broadcast({ type: 'memories:changed' })
    return n
  })

  handle('setTagMeta', (tag: string, patch: { color?: string; label?: string }) => {
    service.store.tags.setMeta(tag, patch)
  })

  handle('renameTag', (from: string, to: string) => {
    const n = service.store.tags.rename(from, to)
    broadcast({ type: 'memories:changed' })
    return n
  })
}
