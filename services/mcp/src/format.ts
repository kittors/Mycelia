import type { CaptureDecision, DocumentHit } from '@mycelia/core'
import type { SearchHit } from '@mycelia/shared'
import { AGENT_LABELS, truncate } from '@mycelia/shared'
import type { StoredMemory } from '@mycelia/store'

/**
 * 面向 agent 的输出格式化。
 *
 * 这里的读者不是人，是另一个 LLM。所以：
 *   - 不用表格（token 贵且模型容易看错列）
 *   - 每条记忆自带 ID，方便 agent 后续引用或要求删除
 *   - 明确标出敏感与待确认状态，避免 agent 把未经确认的信息当事实转述
 *   - 空结果要说清楚「确实没有」，而不是返回空字符串让模型自由发挥
 */
export function formatMemories(
  memories: readonly StoredMemory[],
  hits?: readonly SearchHit[],
): string {
  if (memories.length === 0) {
    return '记忆库中没有找到相关内容。这说明该主题尚未被记录，不要臆测。'
  }

  const hitById = new Map(hits?.map((h) => [h.memoryId, h]) ?? [])
  const lines: string[] = []

  for (const m of memories) {
    const hit = hitById.get(m.id)
    const flags: string[] = []
    if (m.status === 'pending') flags.push('待用户确认')
    if (m.locked) flags.push('已加密·需在 Mycelia 桌面端解锁')
    if (m.sensitivity === 'secret') flags.push('敏感')
    if (m.pinned) flags.push('已置顶')

    lines.push(`### ${m.title}`)

    const meta: string[] = [`类型 ${m.kind}`]
    if (m.tags.length) meta.push(`标签 ${m.tags.join(' ')}`)
    if (m.origin.project) meta.push(`项目 ${m.origin.project}`)
    meta.push(`来源 ${AGENT_LABELS[m.origin.agent as keyof typeof AGENT_LABELS] ?? m.origin.agent}`)
    meta.push(`更新 ${new Date(m.updatedAt).toLocaleDateString('zh-CN')}`)
    if (hit?.viaMemoryId) meta.push('由关联记忆带出')
    if (flags.length) meta.push(`⚠ ${flags.join('、')}`)
    lines.push(`_${meta.join(' · ')}_`)

    lines.push('')
    lines.push(m.locked ? '（内容已加密，此处不可见）' : m.content)
    lines.push('')
    lines.push(`\`id: ${m.id}\``)
    lines.push('')
  }

  return lines.join('\n').trim()
}

/** 简短列表，用于 related / neighbors 这类辅助工具 */
export function formatBrief(memories: readonly StoredMemory[]): string {
  if (memories.length === 0) return '（无）'
  return memories
    .map(
      (m) =>
        `- [${m.kind}] ${m.title}${m.tags.length ? ` · ${m.tags.join(' ')}` : ''}  \`${m.id}\``,
    )
    .join('\n')
}

/**
 * 文档检索结果。
 *
 * 每条都给出文件路径与章节 —— agent 需要能把结论落回到具体文件，
 * 用户才能验证「你说的这句到底写在哪」。
 */
export function formatDocumentHits(query: string, hits: readonly DocumentHit[]): string {
  const lines = [`文档库中命中 ${hits.length} 处「${truncate(query, 40)}」：`, '']

  for (const hit of hits) {
    lines.push(`### ${hit.document.title}${hit.heading ? ` › ${hit.heading}` : ''}`)
    lines.push(`_${hit.source.name} · ${hit.document.relPath}_`)
    lines.push('')
    lines.push(hit.context)
    lines.push('')
  }

  lines.push('---')
  lines.push('以上是文档原文摘录。引用时请注明出处文件，不要改写成断言。')
  return lines.join('\n')
}

/**
 * 准入结果。
 *
 * 被拒时必须说清理由并给出下一步 —— agent 拿到一句「失败」会盲目重试，
 * 拿到「这属于一次性上下文」才会停下。
 */
export function renderCaptureOutcome(
  decision: CaptureDecision,
  memory: StoredMemory | null,
): string {
  switch (decision.verdict) {
    case 'accept':
      return [
        `已记住：「${memory?.title ?? ''}」`,
        `类型 ${memory?.kind} · 敏感度 ${memory?.sensitivity}${memory?.sensitivity === 'secret' ? '（内容已加密）' : ''}`,
        `id: ${memory?.id}`,
      ].join('\n')

    case 'merge':
      return [
        `已更新既有记忆：「${memory?.title ?? ''}」`,
        decision.reason,
        `id: ${memory?.id}`,
      ].join('\n')

    case 'review':
      return [
        `已放入待确认队列：「${memory?.title ?? ''}」`,
        `原因：${decision.reason}`,
        '用户会在 Mycelia 桌面端确认。不要重复写入同一条内容。',
        `id: ${memory?.id}`,
      ].join('\n')

    case 'reject':
      return [
        '未写入记忆库。',
        `原因：${decision.reason}`,
        '这条内容不具备跨会话的长期价值。如果用户明确要求记住，请带上 user_requested=true 重试。',
      ].join('\n')
  }
}

export function formatSearchSummary(
  query: string,
  count: number,
  channels: { vector: number; keyword: number; graph: number },
  durationMs: number,
): string {
  return `查询「${truncate(query, 40)}」命中 ${count} 条（语义 ${channels.vector} / 关键词 ${channels.keyword} / 图谱扩散 ${channels.graph}，${durationMs}ms）`
}
