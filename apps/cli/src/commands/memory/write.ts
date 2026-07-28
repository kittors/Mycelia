/** 变更类命令：add / remove / review */

import type { MemoryService } from '@mycelia/core'
import { MemoryKind } from '@mycelia/shared'
import { c, clearProgress, confirm, fail, header, kindBadge, line, success } from '../../ui.js'

import { resolveMemory } from './shared.js'

export async function addCommand(
  service: MemoryService,
  opts: {
    title?: string
    content?: string
    kind?: string
    tag?: string[]
    sensitivity?: string
    importance?: string
    project?: string
    pin?: boolean
  },
): Promise<void> {
  const { prompt } = await import('../../ui.js')
  const title = opts.title ?? (await prompt('标题：'))
  if (!title) {
    fail('标题不能为空')
    process.exitCode = 1
    return
  }
  const content = opts.content ?? (await prompt('内容：'))
  if (!content) {
    fail('内容不能为空')
    process.exitCode = 1
    return
  }

  const kindParsed = MemoryKind.safeParse(opts.kind ?? 'fact')
  const memory = await service.remember({
    kind: kindParsed.success ? kindParsed.data : 'fact',
    title,
    content,
    tags: opts.tag ?? [],
    sensitivity: (opts.sensitivity as 'public' | 'private' | 'secret') ?? 'private',
    importance: opts.importance ? Number(opts.importance) : 0.7,
    confidence: 1,
    pinned: opts.pin ?? false,
    status: 'active',
    origin: { agent: 'manual', project: opts.project },
  })

  success(`已记住「${memory.title}」${c.gray(memory.id)}`)
  if (memory.sensitivity === 'secret') line(c.gray('  内容已加密存储'))
}

export async function removeCommand(
  service: MemoryService,
  ids: string[],
  opts: { yes?: boolean },
): Promise<void> {
  const targets = ids
    .map((id) => resolveMemory(service, id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))

  if (targets.length === 0) {
    fail('没有匹配的记忆')
    process.exitCode = 1
    return
  }

  if (!opts.yes) {
    line('将删除：')
    for (const m of targets) line(`  ${kindBadge(m.kind)} ${m.title}`)
    if (!(await confirm('确认删除？'))) {
      line(c.gray('已取消'))
      return
    }
  }

  let n = 0
  for (const m of targets) if (service.forget(m.id)) n++
  success(`已删除 ${n} 条记忆`)
}

export async function reviewCommand(
  service: MemoryService,
  opts: { limit?: string },
): Promise<void> {
  const pending = service.store.memories.list({
    status: ['pending'],
    limit: Number(opts.limit ?? 20),
    orderBy: 'importance',
  })

  if (pending.length === 0) {
    success('没有待确认的记忆')
    return
  }

  header(`待确认记忆 ${c.gray(`(${pending.length})`)}`)
  line(c.gray('  这些是自动提取的候选项，确认后才会进入正式记忆库。'))

  let accepted = 0
  let rejected = 0
  for (const m of pending) {
    line('')
    line(`  ${kindBadge(m.kind)} ${c.bold(m.title)}`)
    line(
      `  ${c.gray(`${m.tags.join(' ') || '无标签'} · ${m.origin.agent}/${m.origin.project ?? '-'} · 置信度 ${(m.confidence * 100).toFixed(0)}%`)}`,
    )
    for (const l of m.content.split('\n').slice(0, 4)) line(`    ${l}`)

    const { prompt } = await import('../../ui.js')
    const answer = (
      await prompt(`保留？ ${c.gray('[y]保留 / [n]删除 / [s]跳过 / [q]退出')}`)
    ).toLowerCase()
    if (answer === 'q') break
    if (answer === 'n') {
      service.reject(m.id)
      rejected++
    } else if (answer === 'y' || answer === '') {
      service.accept(m.id)
      accepted++
    }
  }

  clearProgress()
  line('')
  success(`确认 ${accepted} 条，删除 ${rejected} 条`)
}
