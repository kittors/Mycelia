/** 图谱、纪要、重建索引、配置读写 */

import type { MemoryService } from '@mycelia/core'
import { DAY_MS } from '@mycelia/shared'
import { patchConfig } from '@mycelia/store'
import {
  c,
  clearProgress,
  formatDuration,
  header,
  kv,
  line,
  progress,
  success,
  table,
} from '../../ui.js'
import { getPath, parseValue, setPath } from './helpers.js'

export function graphCommand(
  service: MemoryService,
  opts: { rebuild?: boolean; json?: boolean; tag?: string[]; project?: string; pending?: boolean },
): void {
  if (opts.rebuild) {
    header('重建图谱')
    const result = service.rebuildGraph((done, total) => progress(done, total, '计算关联'))
    clearProgress()
    success(
      `${result.scanned} 个节点，${result.created} 条边，耗时 ${formatDuration(result.durationMs)}`,
    )
    return
  }

  const snapshot = service.graph({
    tags: opts.tag,
    project: opts.project,
    statuses: opts.pending ? ['active', 'pending'] : ['active'],
  })

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2))
    return
  }

  header('知识图谱')
  kv('记忆节点', String(snapshot.stats.memoryCount))
  kv('实体节点', String(snapshot.stats.entityCount))
  kv('关联边', String(snapshot.stats.edgeCount))
  kv('聚簇', String(snapshot.stats.clusterCount))

  header('主要簇')
  table(
    snapshot.clusters
      .slice(0, 12)
      .map((cl) => [cl.label, `${cl.size} 节点`, c.gray(cl.topTags.slice(0, 3).join(' '))]),
  )
  line('')
}

export async function digestCommand(
  service: MemoryService,
  opts: { days?: string },
): Promise<void> {
  const days = Number(opts.days ?? 7)
  header(`最近 ${days} 天`)
  const text = await service.digest(Date.now() - days * DAY_MS)
  line(
    text
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
  )
  line('')
}

export async function reindexCommand(service: MemoryService): Promise<void> {
  header('补齐向量')
  const n = await service.pipeline.backfillEmbeddings((done) => progress(done, done + 1, '嵌入中'))
  clearProgress()
  success(`补齐 ${n} 条记忆的向量`)

  header('重建图谱')
  const result = service.rebuildGraph((done, total) => progress(done, total, '计算关联'))
  clearProgress()
  success(`${result.created} 条边`)
  line('')
}

export function configCommand(service: MemoryService, key?: string, value?: string): void {
  if (!key) {
    console.log(JSON.stringify(service.config, null, 2))
    return
  }

  if (value === undefined) {
    const v = getPath(service.config as unknown as Record<string, unknown>, key)
    console.log(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
    return
  }

  const patch = setPath(key, parseValue(value))
  patchConfig(patch as never)
  success(`已设置 ${key} = ${value}`)
  line(c.gray('  重启 daemon / 桌面端后生效'))
}
