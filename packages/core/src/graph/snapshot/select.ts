/**
 * 选点：从可能上十万条记忆里挑出这一屏该画的那些。
 *
 * 天真的做法是「按重要度取前 N 条」，但那样选出来的图几乎没有边 ——
 * 重要度高的记忆彼此之间未必有关联，两端都恰好落进这 N 条的边少之又少。
 * 实测一万条记忆、两万条关联，按重要度截断到 1200 条后边数是 **0**：
 * 屏幕上是一千多个互不相干的孤点，图谱彻底失去意义。
 *
 * 所以选点必须以连通性为目标：先挑一批种子，再顺着边把它们的邻居拉进来，
 * 得到的是若干个成形的邻域，而不是一把散沙。
 */

import type { Edge } from '@mycelia/shared'
import type { ListFilter, MyceliaStore, StoredMemory } from '@mycelia/store'

/**
 * 每个邻域的目标大小。
 *
 * 这个数决定了图上会出现「几团」还是「一片散沙」，是整个选点里
 * 最影响观感的常量。
 *
 * 早先的做法是把 35% 的配额都给种子（1200 个位置里 420 个种子），
 * 剩下 780 个位置分给 420 个种子去扩展 —— 平均每个种子只能拉进
 * 不到两个邻居。结果是 420 个互不相干的碎片：社区检测切出两百多个簇、
 * 平均每簇四个点，力导向也无从把它们聚成团，因为它们本来就不成团。
 *
 * 改成少量种子、每个长成一片完整邻域。同一邻域内部连接密集，
 * 力导向自然会把它们拉到一起，社区检测也能给出干净的划分 ——
 * 此时画在图上的圈才真的圈住了「一伙人」。
 */
const NEIGHBORHOOD_SIZE = 40

export function selectConnected(
  store: MyceliaStore,
  filter: Omit<ListFilter, 'limit' | 'orderBy'>,
  edges: readonly Edge[],
  maxNodes: number,
  /**
   * 必须出现在结果里的节点。
   *
   * 搜索命中的记忆多半不在「重要度前 N」里 —— 大库里用户找的往往正是
   * 那些平时不显眼的。没有这个入口，搜到了也定位不过去。
   */
  focusId?: string,
): StoredMemory[] {
  const seeds = store.memories.list({ ...filter, orderBy: 'importance', limit: maxNodes })
  if (seeds.length < maxNodes) return seeds

  /**
   * 邻接表建在**全部**边上，不能只用种子内部的边。
   *
   * 这是十万级库里最关键的一处。早先的做法是先按重要度取一个候选池，
   * 再在池内部找连通关系 —— 但十万条记忆里池子只占几个百分点，
   * 一条边的两端同时落进池里的概率不到 1%，于是三十万条关联最后只剩
   * 一百来条能画，图退化成一片孤点。
   *
   * 建在全部边上之后，种子可以顺着边扩展到池子外面去，
   * 拉进来的正是那些「跟重要记忆有关系」的节点 —— 这比「自己重要」
   * 更贴近用户想在图里看到的东西。
   */
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const from = adjacency.get(edge.sourceId)
    if (from) from.push(edge.targetId)
    else adjacency.set(edge.sourceId, [edge.targetId])
    const to = adjacency.get(edge.targetId)
    if (to) to.push(edge.sourceId)
    else adjacency.set(edge.targetId, [edge.sourceId])
  }

  const selected = new Set<string>()

  /**
   * 把一个种子的邻域整片取下来。
   *
   * 逐个种子跑完再换下一个，而不是所有种子共用一个队列交错推进 ——
   * 共享队列会让配额在几百个种子之间均摊，每个都只长出一两个邻居，
   * 最后谁也没成形。这里每次都把一片邻域填满才罢手。
   */
  const growFrom = (root: string, budget: number): number => {
    if (selected.has(root)) return 0
    const queue = [root]
    selected.add(root)
    let taken = 1
    let head = 0

    while (head < queue.length && taken < budget && selected.size < maxNodes) {
      const current = queue[head++]
      if (!current) break
      for (const neighbor of adjacency.get(current) ?? []) {
        if (taken >= budget || selected.size >= maxNodes) break
        if (selected.has(neighbor)) continue
        selected.add(neighbor)
        queue.push(neighbor)
        taken++
      }
    }
    return taken
  }

  // 聚焦目标最先展开，它的邻域优先占用配额
  if (focusId) growFrom(focusId, NEIGHBORHOOD_SIZE)

  /**
   * 种子只取有连接的，且优先取连接多的。
   *
   * 孤立节点当种子是浪费配额：它扩展不出任何东西，只在画面边缘多一个孤点。
   * 而连接多的节点是天然的邻域中心，从它出发能长出更完整的一团。
   */
  const hubs = seeds
    .filter((memory) => adjacency.has(memory.id))
    .sort((a, b) => (adjacency.get(b.id)?.length ?? 0) - (adjacency.get(a.id)?.length ?? 0))

  for (const memory of hubs) {
    if (selected.size >= maxNodes) break
    growFrom(memory.id, NEIGHBORHOOD_SIZE)
  }

  // 配额没用完说明边太稀疏，用重要度最高的补齐 —— 空着屏幕并不更好
  for (const memory of seeds) {
    if (selected.size >= maxNodes) break
    selected.add(memory.id)
  }

  /**
   * BFS 扩展到的节点可能不在种子列表里，得单独取回来。
   *
   * 同时要过掉不符合过滤条件的：邻接表是全库的，顺着边可能走到
   * 已归档或被 kind 过滤排除的记忆上，那些不该出现在这张图里。
   */
  const known = new Map(seeds.map((m) => [m.id, m]))
  const missing = [...selected].filter((id) => !known.has(id))
  const fetched = missing.length > 0 ? store.memories.getMany(missing) : []

  const statuses = filter.status ? new Set(filter.status) : null
  const kinds = filter.kinds ? new Set(filter.kinds) : null
  const allowed = (m: StoredMemory) =>
    (!statuses || statuses.has(m.status)) && (!kinds || kinds.has(m.kind))

  return [...seeds.filter((m) => selected.has(m.id)), ...fetched.filter(allowed)]
}
