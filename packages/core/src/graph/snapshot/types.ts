/** 图谱快照的内部类型 */

import type { UndirectedGraph } from 'graphology'

/** 图节点属性 —— 显式声明后，forEachNode 的回调才有类型 */
interface NodeAttrs {
  type: 'memory' | 'entity'
  label: string
  kind: string
  tags: string[]
  project?: string
  importance?: number
  pinned?: boolean
  sensitivity?: string
  status?: string
  updatedAt?: number
  accessCount?: number
  mentionCount?: number
}

interface EdgeAttrs {
  id: string
  kind: string
  weight: number
  reason: string
}

type MyceliaGraph = UndirectedGraph<NodeAttrs, EdgeAttrs>

export interface SnapshotOptions {
  /** 只看这些标签下的子图 */
  tags?: string[]
  /** 只看某个项目 */
  project?: string
  kinds?: string[]
  /** 时间窗口 */
  since?: number
  /** 是否把实体画成节点 */
  includeEntities?: boolean
  /** 节点上限，超出时按重要度截断 —— 保护渲染性能 */
  maxNodes?: number
  /** 聚焦某个节点，只返回它的 N 跳邻域 */
  focusId?: string
  focusDepth?: number
  /** 纳入哪些状态的记忆。默认只看已生效的；开启 pending 可以在图上审阅候选记忆 */
  statuses?: string[]
}

export type { EdgeAttrs, MyceliaGraph, NodeAttrs }
