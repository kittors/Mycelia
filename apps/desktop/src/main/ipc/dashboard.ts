/**
 * 概览与时间线的数据聚合。
 *
 * 这些查询把散落在各仓储里的统计拼成前端一次就能用的形状 ——
 * 让渲染层发七八个 IPC 再自己组装，既慢又容易各页面算得不一致。
 */

import type { MemoryService } from '@mycelia/core'
import { integrationStatus, skillStatus } from '@mycelia/integrations'
import { DAY_MS } from '@mycelia/shared'
import type { DashboardData, TimelineEntry } from '../../shared/ipc-contract.js'
import type { Handle } from './registry.js'

/** 热力图覆盖的天数：53 周整，保证首尾都是完整的周列 */
const ACTIVITY_DAYS = 53 * 7

export function registerDashboardHandlers(handle: Handle, service: MemoryService): void {
  handle('getDashboard', (): DashboardData => {
    const stats = service.store.memories.stats()
    const vaultStatus = service.store.vault.status()
    const sources = service.store.sources.all()

    return {
      stats: {
        total: stats.total,
        pending: stats.pending,
        byKind: stats.byKind,
        byProject: stats.byProject,
        byAgent: stats.byAgent,
        bySensitivity: stats.bySensitivity,
        embedded: stats.embedded,
      },
      recent: service.store.memories.list({ limit: 8, orderBy: 'created' }),
      pending: service.store.memories.list({
        status: ['pending'],
        limit: 6,
        orderBy: 'importance',
      }),
      topTags: service.store.tags.usage().slice(0, 24),
      activity: buildActivity(service),
      lastSyncAt: Number(service.store.meta('lastSyncAt')) || null,
      agents: mergeAgentStatus(service),
      vault: {
        initialized: vaultStatus.initialized,
        unlocked: vaultStatus.unlocked,
        secretCount: service.store.memories.count({ sensitivity: ['secret'] }),
      },
      knowledge: {
        sources: sources.length,
        documents: sources.reduce((sum, source) => sum + source.docCount, 0),
        chunks: service.store.chunks.count(),
      },
      models: {
        embedder: {
          id: service.embedder.id,
          kind: service.embedder.kind,
          dims: service.embedder.dimensions,
        },
        llm: { id: service.llm.id, model: service.llm.model, enabled: service.llm.enabled },
      },
    }
  })

  handle('getTimeline', (weeks = 12): TimelineEntry[] => {
    const out: TimelineEntry[] = []
    const now = new Date()
    // 周一作为一周的起点，符合中文语境的习惯
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))

    for (let i = 0; i < weeks; i++) {
      const start = monday.getTime() - i * 7 * DAY_MS
      const end = start + 7 * DAY_MS
      const memories = service.store.memories.list({
        since: start,
        until: end,
        status: ['active'],
        limit: 200,
        orderBy: 'created',
      })
      const sessions = service.store.conversations
        .recent(200)
        .filter((c) => c.endedAt >= start && c.endedAt < end)

      if (memories.length === 0 && sessions.length === 0) continue

      const projectCount = new Map<string, number>()
      for (const m of memories) {
        const p = m.origin.project ?? '未归类'
        projectCount.set(p, (projectCount.get(p) ?? 0) + 1)
      }

      out.push({
        weekStart: start,
        weekLabel: formatWeek(start),
        memories,
        projects: [...projectCount.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        sessionCount: sessions.length,
      })
    }
    return out
  })
}

/**
 * 按天统计新增记忆，供热力图使用。
 *
 * 走一次 SQL 分组而不是逐天查询：热力图要覆盖整年，
 * 按天循环就是 371 次查询，而记忆表按天分组一次就够。
 *
 * date(..., 'localtime') 很关键 —— 用 UTC 分组的话，
 * 晚上写的记忆会被算到第二天，用户看到的格子和他的记忆对不上。
 */
function buildActivity(service: MemoryService): DashboardData['activity'] {
  const since = Date.now() - ACTIVITY_DAYS * DAY_MS

  const rows = service.store.db
    .prepare(`
      SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(*) AS n,
             kind
      FROM memories
      WHERE created_at >= ? AND status IN ('active', 'pending')
      GROUP BY day, kind
    `)
    .all(since) as Array<{ day: string; n: number; kind: string }>

  const byDay = new Map<string, { count: number; byKind: Record<string, number> }>()
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { count: 0, byKind: {} }
    entry.count += row.n
    entry.byKind[row.kind] = (entry.byKind[row.kind] ?? 0) + row.n
    byDay.set(row.day, entry)
  }

  // 补齐没有记忆的日子：热力图需要连续的格子，缺一天就会错位
  const out: DashboardData['activity'] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() - (ACTIVITY_DAYS - 1))

  for (let i = 0; i < ACTIVITY_DAYS; i++) {
    const date = toLocalDate(cursor)
    const entry = byDay.get(date)
    out.push({ date, count: entry?.count ?? 0, byKind: entry?.byKind ?? {} })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/** 本地时区的 YYYY-MM-DD，与 SQL 的 localtime 分组保持一致 */
function toLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function mergeAgentStatus(service: MemoryService): DashboardData['agents'] {
  const availability = service.ingest.availability()
  const integrations = integrationStatus()
  const skills = skillStatus(integrations.map((item) => item.agent))
  return availability.map((a) => ({
    agent: a.agent,
    available: a.available,
    path: a.path,
    installed: integrations.find((i) => i.agent === a.agent)?.installed ?? false,
    skillInstalled: skills.find((s) => s.agent === a.agent)?.installed ?? false,
  }))
}

function formatWeek(start: number): string {
  const d = new Date(start)
  const end = new Date(start + 6 * DAY_MS)
  const sameMonth = d.getMonth() === end.getMonth()
  const fmt = (x: Date) => `${x.getMonth() + 1}月${x.getDate()}日`
  return sameMonth ? `${fmt(d)} – ${end.getDate()}日` : `${fmt(d)} – ${fmt(end)}`
}
