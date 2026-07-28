/**
 * 记忆查询的 SQL 构造与标签规范化。
 *
 * 纯函数，不碰数据库连接 —— 这样过滤条件的组合逻辑能被单独推敲和测试，
 * 不必先起一个 SQLite 实例。
 */

import { normalizeTag } from '@mycelia/shared'
import type { ListFilter } from './types.js'

export function normalizeTags(tags: readonly string[]): string[] {
  const out = new Set<string>()
  for (const t of tags) {
    const n = normalizeTag(t)
    if (n) out.add(n)
  }
  return [...out]
}

/**
 * trigram FTS 的查询构造。
 * trigram 要求每个 token 至少 3 个字符，中文两字词会被直接丢弃 ——
 * 所以这里对短词退化成前缀匹配，避免「网络」这种词搜不到。
 */
export function toFtsQuery(input: string): string {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, '').trim())
    .filter((t) => t.length > 0)
  if (terms.length === 0) return '""'
  return terms.map((t) => (t.length >= 3 ? `"${t}"` : `"${t}"*`)).join(' OR ')
}

export function buildListQuery(
  filter: ListFilter,
  countOnly = false,
): { sql: string; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []

  if (filter.kinds?.length) {
    where.push(`kind IN (${filter.kinds.map(() => '?').join(',')})`)
    params.push(...filter.kinds)
  }
  if (filter.status?.length) {
    where.push(`status IN (${filter.status.map(() => '?').join(',')})`)
    params.push(...filter.status)
  } else {
    where.push("status = 'active'")
  }
  if (filter.sensitivity?.length) {
    where.push(`sensitivity IN (${filter.sensitivity.map(() => '?').join(',')})`)
    params.push(...filter.sensitivity)
  }
  if (filter.project) {
    where.push("json_extract(origin, '$.project') = ?")
    params.push(filter.project)
  }
  if (filter.agent) {
    where.push("json_extract(origin, '$.agent') = ?")
    params.push(filter.agent)
  }
  if (filter.since) {
    where.push('created_at >= ?')
    params.push(filter.since)
  }
  if (filter.until) {
    where.push('created_at <= ?')
    params.push(filter.until)
  }
  if (filter.pinnedOnly) where.push('pinned = 1')

  if (filter.tags?.length) {
    // 标签存 JSON 数组，用 EXISTS + json_each 做包含判断；
    // LIKE '%tag%' 会把 infra 误匹配到 infrastructure，不能用
    const mode = filter.tagMode ?? 'any'
    const clause = filter.tags
      .map(
        () =>
          "EXISTS (SELECT 1 FROM json_each(memories.tags) WHERE json_each.value = ? OR json_each.value LIKE ? || '/%')",
      )
      .join(mode === 'all' ? ' AND ' : ' OR ')
    where.push(`(${clause})`)
    for (const t of filter.tags) params.push(normalizeTag(t), normalizeTag(t))
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  if (countOnly) {
    return { sql: `SELECT COUNT(*) n FROM memories ${whereSql}`, params }
  }

  const orderMap = {
    updated: 'updated_at DESC',
    created: 'created_at DESC',
    importance: 'pinned DESC, importance DESC, updated_at DESC',
    accessed: 'access_count DESC, last_accessed_at DESC',
  } as const
  const order = orderMap[filter.orderBy ?? 'updated']

  params.push(filter.limit ?? 50, filter.offset ?? 0)
  return {
    sql: `SELECT * FROM memories ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    params,
  }
}
