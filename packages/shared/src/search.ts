import { z } from 'zod'
import { MemoryKind, Sensitivity } from './memory.js'

export const SearchQuery = z.object({
  /** 自然语言查询；为空时退化为按过滤条件浏览 */
  text: z.string().default(''),
  kinds: z.array(MemoryKind).optional(),
  tags: z.array(z.string()).optional(),
  /** 标签匹配模式：any = 任一命中，all = 全部命中 */
  tagMode: z.enum(['any', 'all']).default('any'),
  project: z.string().optional(),
  agent: z.string().optional(),
  sensitivity: z.array(Sensitivity).optional(),
  /** 时间窗口，用于「这周干了啥」这类查询 */
  since: z.number().int().optional(),
  until: z.number().int().optional(),
  limit: z.number().int().min(1).max(200).default(8),
  /** 是否返回 secret 记忆的明文（需已解锁） */
  includeSecrets: z.boolean().default(false),
  /** 是否包含待确认与已归档记忆 */
  includePending: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  /** 沿图谱扩散一跳 */
  expandGraph: z.boolean().default(true),
})
export type SearchQuery = z.infer<typeof SearchQuery>

export const SearchHit = z.object({
  memoryId: z.string(),
  score: z.number(),
  /** 得分构成，UI 上可以解释「为什么召回这条」 */
  breakdown: z.object({
    vector: z.number().default(0),
    keyword: z.number().default(0),
    recency: z.number().default(0),
    importance: z.number().default(0),
    graph: z.number().default(0),
  }),
  /** 命中的片段，带 <mark> 标记 */
  snippet: z.string().default(''),
  /** 若该结果是被图谱扩散带出来的，记录是从哪条记忆扩散来的 */
  viaMemoryId: z.string().optional(),
})
export type SearchHit = z.infer<typeof SearchHit>
