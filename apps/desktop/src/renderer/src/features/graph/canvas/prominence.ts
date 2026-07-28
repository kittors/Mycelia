/**
 * 显著性：决定哪些簇值得被「看见」。
 *
 * 一千多个节点会被社区检测切出两三百个簇，其中绝大多数只有一两个成员。
 * 如果一视同仁地给每个簇上色、画轮廓，结果是：
 *
 *   - 十种色相要循环二十几轮，相邻的簇撞色，颜色不再有区分意义；
 *   - 两百多圈轮廓层层叠叠，画面糊成一团半透明的浆糊。
 *
 * 所以只把「主要的簇」呈现出来，其余归入中性色、不画轮廓。
 * 少数几个大簇能一眼认出，比两百个都标出来却谁也看不清有用得多。
 */

import type { GraphSnapshot } from '@mycelia/shared'

/** 最多同时突出多少个簇。超过十来个，颜色本身就不再可区分了 */
const MAX_PROMINENT = 12

/** 成员数少于这个的簇不算「一团」，只是零星几个点 */
const MIN_CLUSTER_SIZE = 3

/**
 * 着色节点的目标覆盖率。
 *
 * 固定「取最大的 N 个簇」在两种数据上都不对：
 * 社区结构明显时（几个大簇占了大半节点）取 12 个是浪费，几个就够了；
 * 结构碎片化时（几百个小簇平分节点）取 12 个只覆盖一成半，
 * 画面上八成半是灰点、一成半是彩色散点，看着像坏了。
 *
 * 改成按覆盖率收：从大到小累加，够了就停，同时受颜色数量上限约束。
 */
const TARGET_COVERAGE = 0.55

export interface Prominence {
  /** 值得着色与画轮廓的簇编号 */
  ids: ReadonlySet<number>
  /** 簇编号 → 色板下标。用下标而不是簇编号取色，保证突出的簇之间颜色最大程度不同 */
  colorIndex: ReadonlyMap<number, number>
}

export function computeProminence(snapshot: GraphSnapshot): Prominence {
  const ranked = snapshot.clusters
    .filter((cluster) => cluster.size >= MIN_CLUSTER_SIZE)
    .sort((a, b) => b.size - a.size)

  const target = snapshot.nodes.length * TARGET_COVERAGE
  const major: typeof ranked = []
  let covered = 0
  for (const cluster of ranked) {
    if (major.length >= MAX_PROMINENT) break
    major.push(cluster)
    covered += cluster.size
    if (covered >= target) break
  }

  const colorIndex = new Map<number, number>()
  for (const [index, cluster] of major.entries()) colorIndex.set(cluster.id, index)

  return { ids: new Set(major.map((cluster) => cluster.id)), colorIndex }
}

/** 空显著性：按类型着色时用，避免调用方到处判空 */
export const NO_PROMINENCE: Prominence = { ids: new Set(), colorIndex: new Map() }
