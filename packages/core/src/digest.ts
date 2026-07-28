/**
 * 工作纪要生成。
 *
 * 回答「这周干了啥」「上个月在忙什么」。有模型就生成叙述性摘要，
 * 没有就按项目分组列出记忆标题 —— 后者信息量低一些，但完全离线可用。
 */

import type { LlmProvider } from '@mycelia/llm'
import { createLogger, DAY_MS, truncate } from '@mycelia/shared'
import type { MyceliaStore, StoredMemory } from '@mycelia/store'
import { DIGEST_SYSTEM_PROMPT } from './extract/prompt.js'

const log = createLogger('core:digest')

export interface DigestContext {
  store: MyceliaStore
  llm: LlmProvider
}

/**
 * 生成时间段内的工作纪要 —— 「这周干了啥」。
 * 有 LLM 就生成叙述性摘要，没有就按项目分组列出记忆标题。
 */
export async function generateDigest(
  ctx: DigestContext,
  sinceMs: number,
  untilMs = Date.now(),
): Promise<string> {
  const memories = ctx.store.memories.list({
    since: sinceMs,
    until: untilMs,
    status: ['active'],
    limit: 300,
    orderBy: 'created',
  })
  const conversations = ctx.store.conversations
    .recent(100)
    .filter((c) => c.endedAt >= sinceMs && c.endedAt <= untilMs)

  if (memories.length === 0 && conversations.length === 0) {
    return '这段时间没有记录。'
  }

  if (!ctx.llm.enabled) {
    return renderFallbackDigest(memories, conversations)
  }

  const byProject = new Map<string, string[]>()
  for (const m of memories) {
    const key = m.origin.project ?? '未归类'
    const arr = byProject.get(key) ?? []
    arr.push(`- [${m.kind}] ${m.title}：${truncate(m.content, 160)}`)
    byProject.set(key, arr)
  }
  for (const c of conversations) {
    const key = c.project ?? '未归类'
    const arr = byProject.get(key) ?? []
    arr.push(`- (会话) ${c.title}`)
    byProject.set(key, arr)
  }

  const input = [...byProject.entries()]
    .map(([project, lines]) => `## ${project}\n${lines.slice(0, 30).join('\n')}`)
    .join('\n\n')

  try {
    const res = await ctx.llm.chat([
      { role: 'system', content: DIGEST_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `时间范围：${new Date(sinceMs).toLocaleDateString('zh-CN')} 至 ${new Date(untilMs).toLocaleDateString('zh-CN')}\n\n${input}`,
      },
    ])
    return res.text.trim() || renderFallbackDigest(memories, conversations)
  } catch (e) {
    log.warn(`纪要生成失败，退回列表模式：${String(e)}`)
    return renderFallbackDigest(memories, conversations)
  }
}

/** 本周纪要 */
export function weeklyDigest(ctx: DigestContext): Promise<string> {
  return generateDigest(ctx, Date.now() - 7 * DAY_MS)
}

// ────────────────────────────── 运维 ──────────────────────────────

function renderFallbackDigest(
  memories: StoredMemory[],
  conversations: Array<{ title: string; project?: string; endedAt: number }>,
): string {
  const byProject = new Map<string, { memories: StoredMemory[]; sessions: number }>()

  for (const m of memories) {
    const key = m.origin.project ?? '未归类'
    const entry = byProject.get(key) ?? { memories: [], sessions: 0 }
    entry.memories.push(m)
    byProject.set(key, entry)
  }
  for (const c of conversations) {
    const key = c.project ?? '未归类'
    const entry = byProject.get(key) ?? { memories: [], sessions: 0 }
    entry.sessions++
    byProject.set(key, entry)
  }

  const lines: string[] = []
  for (const [project, entry] of [...byProject.entries()].sort(
    (a, b) => b[1].memories.length - a[1].memories.length,
  )) {
    lines.push(`### ${project}`)
    lines.push(`共 ${entry.sessions} 次会话，沉淀 ${entry.memories.length} 条记忆。`)
    for (const m of entry.memories.slice(0, 8)) {
      lines.push(`- **${m.title}**（${m.kind}）`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
