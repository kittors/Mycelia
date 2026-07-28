/** 查询类命令：search / list / show */

import type { MemoryService } from '@mycelia/core'
import { DAY_MS, type MemoryKind } from '@mycelia/shared'
import { c, fail, header, kindBadge, kv, line, relativeTime, table } from '../../ui.js'

import { resolveMemory } from './shared.js'

export async function searchCommand(
  service: MemoryService,
  query: string,
  opts: {
    limit?: string
    kind?: string[]
    tag?: string[]
    project?: string
    days?: string
    secrets?: boolean
    pending?: boolean
    json?: boolean
    full?: boolean
  },
): Promise<void> {
  const result = await service.recall({
    text: query,
    limit: Number(opts.limit ?? 8),
    kinds: opts.kind as MemoryKind[] | undefined,
    tags: opts.tag,
    project: opts.project,
    since: opts.days ? Date.now() - Number(opts.days) * DAY_MS : undefined,
    includeSecrets: opts.secrets ?? false,
    includePending: opts.pending ?? false,
  })

  if (opts.json) {
    console.log(JSON.stringify({ hits: result.hits, memories: result.memories }, null, 2))
    return
  }

  header(
    `「${query}」${c.gray(`— ${result.hits.length} 条 · 语义 ${result.channels.vector} / 关键词 ${result.channels.keyword} / 图扩散 ${result.channels.graph} · ${result.durationMs}ms`)}`,
  )

  if (result.memories.length === 0) {
    line(c.gray('  没有找到相关记忆。'))
    return
  }

  for (const m of result.memories) {
    const hit = result.hits.find((h) => h.memoryId === m.id)
    const badges = [kindBadge(m.kind)]
    if (m.status === 'pending') badges.push(c.yellow('待确认'))
    if (m.locked) badges.push(c.red('已加密'))
    if (m.pinned) badges.push(c.cyan('置顶'))

    line('')
    line(`  ${badges.join(' ')} ${c.bold(m.title)}`)
    line(
      `  ${c.gray(`${hit?.score.toFixed(3) ?? ''} · ${m.tags.join(' ') || '无标签'} · ${m.origin.project ?? m.origin.agent} · ${relativeTime(m.updatedAt)}`)}`,
    )
    const body = opts.full ? m.content : m.content.split('\n').slice(0, 3).join('\n')
    for (const l of body.split('\n')) line(`    ${l}`)
    if (!opts.full && m.content.split('\n').length > 3) line(c.gray('    …'))
    line(`  ${c.gray(m.id)}`)
  }
  line('')
}

export function listCommand(
  service: MemoryService,
  opts: {
    kind?: string[]
    tag?: string[]
    project?: string
    limit?: string
    pending?: boolean
    archived?: boolean
    sort?: string
    json?: boolean
  },
): void {
  const status = ['active']
  if (opts.pending) status.push('pending')
  if (opts.archived) status.push('archived')

  const memories = service.store.memories.list({
    kinds: opts.kind,
    tags: opts.tag,
    project: opts.project,
    status,
    limit: Number(opts.limit ?? 30),
    orderBy: (opts.sort as 'updated' | 'created' | 'importance' | 'accessed') ?? 'updated',
  })

  if (opts.json) {
    console.log(JSON.stringify(memories, null, 2))
    return
  }

  header(`记忆列表 ${c.gray(`(${memories.length})`)}`)
  if (memories.length === 0) {
    line(c.gray('  空。跑 `myc sync` 从会话里提取记忆。'))
    return
  }

  table(
    memories.map((m) => [
      c.gray(m.id.slice(-8)),
      kindBadge(m.kind),
      m.status === 'pending' ? c.yellow('待确认') : m.pinned ? c.cyan('置顶') : '',
      m.title.length > 46 ? `${m.title.slice(0, 45)}…` : m.title,
      c.gray(m.tags.slice(0, 2).join(' ')),
      c.gray(relativeTime(m.updatedAt)),
    ]),
  )
  line('')
}

export function showCommand(service: MemoryService, id: string, opts: { json?: boolean }): void {
  const memory = resolveMemory(service, id)
  if (!memory) {
    fail(`找不到记忆：${id}`)
    process.exitCode = 1
    return
  }

  if (opts.json) {
    console.log(JSON.stringify(memory, null, 2))
    return
  }

  header(memory.title)
  kv('ID', memory.id)
  kv('类型', `${kindBadge(memory.kind)} ${c.gray(memory.kind)}`)
  kv('状态', memory.status === 'pending' ? c.yellow('待确认') : memory.status)
  kv('敏感度', memory.sensitivity === 'secret' ? c.red('secret（加密）') : memory.sensitivity)
  kv('标签', memory.tags.join(' ') || c.gray('无'))
  kv(
    '重要度',
    `${(memory.importance * 100).toFixed(0)}%${memory.pinned ? c.cyan(' · 已置顶') : ''}`,
  )
  kv('置信度', `${(memory.confidence * 100).toFixed(0)}%`)
  kv('来源', `${memory.origin.agent}${memory.origin.project ? ` · ${memory.origin.project}` : ''}`)
  if (memory.origin.cwd) kv('目录', c.gray(memory.origin.cwd))
  kv('创建', relativeTime(memory.createdAt))
  kv('更新', relativeTime(memory.updatedAt))
  kv('访问', `${memory.accessCount} 次`)

  line('')
  line(
    memory.locked
      ? c.red('  内容已加密，请先 `myc vault unlock`')
      : memory.content
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
  )

  const neighbors = service.store.edges.neighbors(memory.id, 8)
  if (neighbors.length > 0) {
    header('关联记忆')
    for (const e of neighbors) {
      const otherId = e.sourceId === memory.id ? e.targetId : e.sourceId
      const other = service.store.memories.get(otherId, { decrypt: false })
      if (!other) continue
      line(
        `  ${c.gray(e.weight.toFixed(2))} ${kindBadge(other.kind)} ${other.title} ${c.gray(`— ${e.reason ?? e.kind}`)}`,
      )
    }
  }
  line('')
}
