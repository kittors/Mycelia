/**
 * 记忆的全文检索。
 *
 * 这里有一个 trigram 分词器的硬约束要处理：token 不足 3 个字符就无法匹配，
 * 而中文两字词（「部署」「排查」「网络」）恰恰是最常见的查询形态。
 * 直接交给 FTS 会静默返回空结果，所以短词必须走 LIKE 兜底。
 */

import type { Db } from '../db.js'
import { toFtsQuery } from './query.js'

/** 全文检索。返回 (id, bm25 分数)，分数已转成越大越好 */
export function fullTextSearch(
  db: Db,
  query: string,
  limit: number,
): Array<{ id: string; score: number; snippet: string }> {
  const cleaned = query.trim()
  if (!cleaned) return []

  // trigram 索引的硬约束：token 不足 3 个字符就无法匹配。
  // 中文两字词（「部署」「排查」「网络」）恰恰是最常见的查询形态，
  // 直接交给 FTS 会静默返回空结果 —— 这类查询必须走 LIKE。
  const terms = cleaned.split(/\s+/).filter(Boolean)
  if (terms.every((t) => t.length < 3)) {
    return likeSearch(db, terms, limit)
  }

  try {
    const rows = db
      .prepare(`
        SELECT memory_id, bm25(memory_fts) AS rank,
               snippet(memory_fts, 2, '<mark>', '</mark>', '…', 24) AS snip
        FROM memory_fts
        WHERE memory_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      .all(toFtsQuery(cleaned), limit) as Array<{
      memory_id: string
      rank: number
      snip: string
    }>
    // bm25 返回负数，越小越相关；映射到 0~1
    return rows.map((r) => ({
      id: r.memory_id,
      score: 1 / (1 + Math.exp(r.rank / 4)),
      snippet: r.snip ?? '',
    }))
  } catch {
    // trigram 对某些特殊字符会报语法错，降级为 LIKE
    return likeSearch(db, terms, limit)
  }
}

/**
 * LIKE 兜底检索。
 * secret 记忆的 content 在库里是密文，LIKE 匹配它没有意义也不该匹配 ——
 * 所以只对非 secret 记忆搜正文，secret 只搜标题。
 */
function likeSearch(
  db: Db,
  terms: string[],
  limit: number,
): Array<{ id: string; score: number; snippet: string }> {
  if (terms.length === 0) return []
  const clauses: string[] = []
  const params: unknown[] = []
  for (const t of terms) {
    const like = `%${t.replace(/[%_\\]/g, '')}%`
    clauses.push("(title LIKE ? OR (sensitivity != 'secret' AND content LIKE ?))")
    params.push(like, like)
  }
  params.push(limit)

  const rows = db
    .prepare(`
      SELECT id, title, summary, content, sensitivity FROM memories
      WHERE status IN ('active','pending') AND (${clauses.join(' OR ')})
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `)
    .all(...params) as Array<{
    id: string
    title: string
    summary: string
    content: string
    sensitivity: string
  }>

  return rows.map((r) => {
    // 命中标题的比只命中正文的更相关
    const inTitle = terms.some((t) => r.title.includes(t))
    const body = r.sensitivity === 'secret' ? '' : r.summary || r.content
    return {
      id: r.id,
      score: inTitle ? 0.72 : 0.5,
      snippet: (body || r.title).slice(0, 160),
    }
  })
}
