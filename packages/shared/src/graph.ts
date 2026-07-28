import { z } from 'zod'

/**
 * 边类型 —— 图谱里那些发光的连线到底代表什么关系。
 * 权重统一归一到 0~1，渲染时映射为线宽与亮度。
 */
export const EdgeKind = z.enum([
  /** 语义相似（由向量近邻自动生成） */
  'semantic',
  /** 共享实体：两条记忆提到同一台服务器 / 同一个仓库 */
  'entity',
  /** 共享标签 */
  'tag',
  /** 同一次会话中产生（时序共现） */
  'session',
  /** 同一个项目 */
  'project',
  /** A 推导出 B */
  'derives',
  /** A 被 B 取代 */
  'supersedes',
  /** A 与 B 冲突，需要用户裁决 */
  'contradicts',
  /** 用户手动连的线 */
  'manual',
])
export type EdgeKind = z.infer<typeof EdgeKind>

export const Edge = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  kind: EdgeKind,
  weight: z.number().min(0).max(1).default(0.5),
  /** 边的解释，UI 上 hover 时显示：「都提到了 server-hk-01」 */
  reason: z.string().optional(),
  createdAt: z.number().int(),
})
export type Edge = z.infer<typeof Edge>

export const EdgeInput = Edge.omit({ id: true, createdAt: true }).partial({ weight: true })
export type EdgeInput = z.infer<typeof EdgeInput>

/**
 * 实体 —— 图谱能看出「神经簇」的关键。
 * 记忆之间往往没有直接引用，但都指向同一台服务器、同一个仓库。
 * 把实体也做成节点，簇结构才会自然浮现。
 */
export const EntityKind = z.enum([
  'person',
  'repo',
  'service',
  'host',
  'tech',
  'file',
  'org',
  'concept',
])
export type EntityKind = z.infer<typeof EntityKind>

export const Entity = z.object({
  id: z.string(),
  kind: EntityKind,
  /** 规范化后的唯一名称（小写、去空格） */
  key: z.string(),
  /** 展示名 */
  name: z.string(),
  /** 别名，用于消歧：「香港服务器」==「server-hk-01」== "43.x.x.x" */
  aliases: z.array(z.string()).default([]),
  description: z.string().default(''),
  mentionCount: z.number().int().default(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type Entity = z.infer<typeof Entity>

/** 图谱节点：记忆节点和实体节点在同一张图里 */
export const GraphNode = z.object({
  id: z.string(),
  type: z.enum(['memory', 'entity']),
  label: z.string(),
  kind: z.string(),
  /** 归一化后的节点大小 0~1（记忆按重要度+度数，实体按提及次数） */
  size: z.number(),
  /** Louvain 社区编号 —— 这就是「神经簇」，同簇同色 */
  cluster: z.number().int(),
  sensitivity: z.string().optional(),
  /** active / pending —— 待确认记忆在图上以虚边框呈现 */
  status: z.string().optional(),
  tags: z.array(z.string()).default([]),
  degree: z.number().int().default(0),
  updatedAt: z.number().int().optional(),
  /**
   * 上次算好的坐标。
   *
   * 有值就直接复用，免得每次进图谱都重排一遍 —— 那不只是慢，
   * 更要命的是同一份数据每次位置都不同，人没法在图上建立方位感。
   */
  x: z.number().optional(),
  y: z.number().optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

export const GraphEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.string(),
  weight: z.number(),
  reason: z.string().optional(),
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const GraphSnapshot = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  /** 簇编号 → 簇标签（由簇内高频标签推断，例如「基础设施」「前端」） */
  clusters: z.array(
    z.object({
      id: z.number().int(),
      label: z.string(),
      size: z.number().int(),
      topTags: z.array(z.string()),
    }),
  ),
  stats: z.object({
    memoryCount: z.number().int(),
    entityCount: z.number().int(),
    edgeCount: z.number().int(),
    clusterCount: z.number().int(),
  }),
})
export type GraphSnapshot = z.infer<typeof GraphSnapshot>
