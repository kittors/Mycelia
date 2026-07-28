/**
 * 记忆仓储模块。
 *
 *   repo     写入 / 读取 / 状态流转的门面
 *   query    过滤条件 → SQL
 *   search   全文检索（含中文短词的 LIKE 兜底）
 *   stats    实时聚合统计
 *   secrets  secret 记忆的加解密边界
 */

export { buildListQuery, normalizeTags, toFtsQuery } from './query.js'
export { MemoryRepo } from './repo.js'
export { fullTextSearch } from './search.js'
export { decryptContent, encryptContent, hydrateRow } from './secrets.js'
export { collectStats } from './stats.js'
export type { ListFilter, MemoryStats } from './types.js'
