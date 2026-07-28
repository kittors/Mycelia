import { existsSync, statSync } from 'node:fs'
import type { ConversationMessage, IngestCursor } from '@mycelia/shared'
import { defaultAgentPaths, projectFromPath, truncate } from '@mycelia/shared'
import Database from 'better-sqlite3'
import type { DiscoverOptions, ReadResult, SessionSource, SourceRef } from '../types.js'

/**
 * opencode 把会话存在 SQLite 里（不是 JSONL）：
 *   session(id, title, directory, time_created, time_updated, agent, model)
 *   message(id, session_id, data JSON{role,...}, time_created)
 *   part(id, message_id, data JSON{type:'text'|'tool'|..., text}, time_created)
 *
 * 只读打开对方的数据库。绝不写入 —— 那是别人家的数据。
 * 增量游标这里存的是「已消费到的 message.time_created」，而非字节偏移。
 */
export class OpencodeSource implements SessionSource {
  readonly agent = 'opencode' as const
  readonly rootPath: string
  private db: Database.Database | null = null

  constructor(rootPath?: string) {
    this.rootPath = rootPath ?? defaultAgentPaths().opencode
  }

  isAvailable(): boolean {
    return existsSync(this.rootPath)
  }

  private connect(): Database.Database {
    if (this.db) return this.db
    // readonly 保证我们不可能污染 opencode 自己的库；
    // 它进程还在跑，WAL 模式下并发读是安全的
    this.db = new Database(this.rootPath, { readonly: true, fileMustExist: true })
    this.db.pragma('busy_timeout = 3000')
    return this.db
  }

  async discover(opts: DiscoverOptions = {}): Promise<SourceRef[]> {
    if (!this.isAvailable()) return []
    const db = this.connect()
    const since = opts.since ?? 0
    const rows = db
      .prepare(`
        SELECT id, time_updated, directory
        FROM session
        WHERE time_updated >= ? AND time_archived IS NULL
        ORDER BY time_updated DESC
        ${opts.limit ? 'LIMIT ?' : ''}
      `)
      .all(...(opts.limit ? [since, opts.limit] : [since])) as Array<{
      id: string
      time_updated: number
      directory: string | null
    }>

    const exclude = opts.excludePaths ?? []
    return rows
      .filter((r) => !exclude.some((p) => (r.directory ?? '').startsWith(p)))
      .map((r) => ({
        ref: `opencode:${r.id}`,
        agent: this.agent,
        modifiedAt: r.time_updated,
      }))
  }

  async read(ref: SourceRef, cursor?: IngestCursor): Promise<ReadResult> {
    const db = this.connect()
    const sessionId = ref.ref.replace(/^opencode:/, '')

    const session = db
      .prepare(
        'SELECT id, title, directory, time_created, time_updated, agent, model FROM session WHERE id = ?',
      )
      .get(sessionId) as
      | {
          id: string
          title: string
          directory: string | null
          time_created: number
          time_updated: number
          agent: string | null
          model: string | null
        }
      | undefined

    if (!session) return { conversation: null, cursor: null }

    const sinceTs = cursor?.offset ?? 0
    const rows = db
      .prepare(`
        SELECT m.id AS message_id, m.data AS message_data, m.time_created AS ts,
               p.data AS part_data, p.time_created AS part_ts
        FROM message m
        LEFT JOIN part p ON p.message_id = m.id
        WHERE m.session_id = ? AND m.time_created > ?
        ORDER BY m.time_created ASC, p.time_created ASC
      `)
      .all(sessionId, sinceTs) as Array<{
      message_id: string
      message_data: string
      ts: number
      part_data: string | null
      part_ts: number | null
    }>

    if (rows.length === 0) return { conversation: null, cursor: null }

    // 一条 message 对应多个 part，先按 message 聚合文本
    const grouped = new Map<string, { role: string; ts: number; texts: string[]; tool?: string }>()
    for (const row of rows) {
      let entry = grouped.get(row.message_id)
      if (!entry) {
        const md = safeJson<{ role?: string }>(row.message_data)
        entry = { role: md?.role ?? 'assistant', ts: row.ts, texts: [] }
        grouped.set(row.message_id, entry)
      }
      if (!row.part_data) continue
      const part = safeJson<{ type?: string; text?: string; tool?: string; state?: unknown }>(
        row.part_data,
      )
      if (!part) continue
      if (part.type === 'text' && part.text) {
        entry.texts.push(part.text)
      } else if (part.type === 'tool' && part.tool) {
        entry.tool = part.tool
        entry.texts.push(`[调用工具 ${part.tool}]`)
      }
    }

    const messages: ConversationMessage[] = []
    let maxTs = sinceTs
    for (const [id, entry] of grouped) {
      const text = entry.texts.join('\n').trim()
      maxTs = Math.max(maxTs, entry.ts)
      if (!text) continue
      if (entry.role !== 'user' && entry.role !== 'assistant') continue
      messages.push({
        id,
        role: entry.role,
        text,
        timestamp: entry.ts,
        toolName: entry.tool,
      })
    }

    const cursorOut = {
      sourceRef: ref.ref,
      agent: this.agent,
      offset: maxTs,
      lastModified: session.time_updated,
      lastMessageId: messages.at(-1)?.id,
      messageCount: (cursor?.messageCount ?? 0) + messages.length,
    }

    if (messages.length === 0) return { conversation: null, cursor: cursorOut }

    const model = safeJson<{ id?: string }>(session.model ?? '')?.id
    const cwd = session.directory ?? undefined

    return {
      conversation: {
        id: `opencode:${sessionId}`,
        agent: this.agent,
        sessionId,
        title: truncate(session.title || messages[0]?.text || '未命名会话', 80),
        cwd,
        project: projectFromPath(cwd),
        model,
        startedAt: session.time_created,
        endedAt: session.time_updated,
        messages,
        sourceRef: ref.ref,
      },
      cursor: cursorOut,
    }
  }

  /** 数据库文件的 mtime —— 监听它就能知道 opencode 有没有新对话 */
  lastModified(): number {
    try {
      return statSync(this.rootPath).mtimeMs
    } catch {
      return 0
    }
  }

  close(): void {
    this.db?.close()
    this.db = null
  }
}

function safeJson<T>(s: string): T | undefined {
  try {
    return JSON.parse(s) as T
  } catch {
    return undefined
  }
}
