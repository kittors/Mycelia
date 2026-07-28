/** 记忆命令共用：按 ID 前缀或标题模糊定位一条记忆 */

import type { MemoryService } from '@mycelia/core'
import { fail } from '../../ui.js'

export function resolveMemory(service: MemoryService, id: string) {
  const exact = service.store.memories.get(id)
  if (exact) return exact
  const rows = service.store.db
    .prepare("SELECT id FROM memories WHERE id LIKE '%' || ? LIMIT 2")
    .all(id) as Array<{ id: string }>
  if (rows.length === 1) return service.store.memories.get(rows[0]!.id)
  if (rows.length > 1) fail(`ID「${id}」不唯一，请补全`)
  return undefined
}
