import type { AgentSource, Conversation, IngestCursor } from '@mycelia/shared'
import type { Db } from './db.js'

interface ConversationRow {
  id: string
  agent: string
  session_id: string
  title: string
  cwd: string | null
  project: string | null
  branch: string | null
  model: string | null
  started_at: number
  ended_at: number
  message_count: number
  source_ref: string
  processed_at: number | null
  memory_count: number
  digest: string | null
}

export interface ConversationRecord {
  id: string
  agent: AgentSource
  sessionId: string
  title: string
  cwd?: string
  project?: string
  branch?: string
  model?: string
  startedAt: number
  endedAt: number
  messageCount: number
  sourceRef: string
  processedAt?: number
  memoryCount: number
  digest?: string
}

/** 会话登记簿：记录哪些会话已经被提取过，防止重复烧 LLM 配额 */
export class ConversationRepo {
  constructor(private readonly db: Db) {}

  upsert(conv: Conversation): void {
    this.db
      .prepare(`
        INSERT INTO conversations (
          id, agent, session_id, title, cwd, project, branch, model,
          started_at, ended_at, message_count, source_ref, memory_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          ended_at = MAX(conversations.ended_at, excluded.ended_at),
          message_count = MAX(conversations.message_count, excluded.message_count),
          model = COALESCE(excluded.model, conversations.model)
      `)
      .run(
        conv.id,
        conv.agent,
        conv.sessionId,
        conv.title,
        conv.cwd ?? null,
        conv.project ?? null,
        conv.branch ?? null,
        conv.model ?? null,
        conv.startedAt,
        conv.endedAt,
        conv.messages.length,
        conv.sourceRef,
      )
  }

  markProcessed(id: string, memoryCount: number, digest?: string): void {
    this.db
      .prepare(
        'UPDATE conversations SET processed_at = ?, memory_count = ?, digest = COALESCE(?, digest) WHERE id = ?',
      )
      .run(Date.now(), memoryCount, digest ?? null, id)
  }

  isProcessed(id: string, endedAt: number): boolean {
    const row = this.db
      .prepare('SELECT processed_at, ended_at FROM conversations WHERE id = ?')
      .get(id) as { processed_at: number | null; ended_at: number } | undefined
    if (!row?.processed_at) return false
    // 会话在处理之后又续写了 → 需要重新提取增量部分
    return row.ended_at <= endedAt && row.processed_at >= row.ended_at
  }

  get(id: string): ConversationRecord | undefined {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | ConversationRow
      | undefined
    return row ? toRecord(row) : undefined
  }

  recent(limit = 50, agent?: string): ConversationRecord[] {
    const rows = agent
      ? (this.db
          .prepare('SELECT * FROM conversations WHERE agent = ? ORDER BY ended_at DESC LIMIT ?')
          .all(agent, limit) as ConversationRow[])
      : (this.db
          .prepare('SELECT * FROM conversations ORDER BY ended_at DESC LIMIT ?')
          .all(limit) as ConversationRow[])
    return rows.map(toRecord)
  }

  unprocessed(limit = 20, minMessages = 4): ConversationRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM conversations
        WHERE processed_at IS NULL AND message_count >= ?
        ORDER BY ended_at DESC LIMIT ?
      `)
      .all(minMessages, limit) as ConversationRow[]
    return rows.map(toRecord)
  }

  stats(): { total: number; processed: number; byAgent: Record<string, number> } {
    const total = (this.db.prepare('SELECT COUNT(*) n FROM conversations').get() as { n: number }).n
    const processed = (
      this.db
        .prepare('SELECT COUNT(*) n FROM conversations WHERE processed_at IS NOT NULL')
        .get() as {
        n: number
      }
    ).n
    const byAgent = Object.fromEntries(
      (
        this.db
          .prepare('SELECT agent, COUNT(*) n FROM conversations GROUP BY agent')
          .all() as Array<{
          agent: string
          n: number
        }>
      ).map((r) => [r.agent, r.n]),
    )
    return { total, processed, byAgent }
  }
}

/** 增量游标：每个源文件读到哪儿了 */
export class CursorRepo {
  constructor(private readonly db: Db) {}

  get(sourceRef: string): IngestCursor | undefined {
    const row = this.db
      .prepare('SELECT * FROM ingest_cursors WHERE source_ref = ?')
      .get(sourceRef) as
      | {
          source_ref: string
          agent: string
          offset: number
          last_modified: number
          last_message_id: string | null
          message_count: number
          updated_at: number
        }
      | undefined
    if (!row) return undefined
    return {
      sourceRef: row.source_ref,
      agent: row.agent as AgentSource,
      offset: row.offset,
      lastModified: row.last_modified,
      lastMessageId: row.last_message_id ?? undefined,
      messageCount: row.message_count,
      updatedAt: row.updated_at,
    }
  }

  save(cursor: Omit<IngestCursor, 'updatedAt'>): void {
    this.db
      .prepare(`
        INSERT INTO ingest_cursors (source_ref, agent, offset, last_modified, last_message_id, message_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_ref) DO UPDATE SET
          offset = excluded.offset,
          last_modified = excluded.last_modified,
          last_message_id = excluded.last_message_id,
          message_count = excluded.message_count,
          updated_at = excluded.updated_at
      `)
      .run(
        cursor.sourceRef,
        cursor.agent,
        cursor.offset,
        cursor.lastModified,
        cursor.lastMessageId ?? null,
        cursor.messageCount,
        Date.now(),
      )
  }

  all(agent?: string): IngestCursor[] {
    const rows = agent
      ? (this.db.prepare('SELECT * FROM ingest_cursors WHERE agent = ?').all(agent) as Array<
          Record<string, never>
        >)
      : (this.db.prepare('SELECT * FROM ingest_cursors').all() as Array<Record<string, never>>)
    return rows.map((r) => {
      const row = r as unknown as {
        source_ref: string
        agent: string
        offset: number
        last_modified: number
        last_message_id: string | null
        message_count: number
        updated_at: number
      }
      return {
        sourceRef: row.source_ref,
        agent: row.agent as AgentSource,
        offset: row.offset,
        lastModified: row.last_modified,
        lastMessageId: row.last_message_id ?? undefined,
        messageCount: row.message_count,
        updatedAt: row.updated_at,
      }
    })
  }

  reset(agent?: string): void {
    if (agent) this.db.prepare('DELETE FROM ingest_cursors WHERE agent = ?').run(agent)
    else this.db.prepare('DELETE FROM ingest_cursors').run()
  }
}

function toRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    agent: row.agent as AgentSource,
    sessionId: row.session_id,
    title: row.title,
    cwd: row.cwd ?? undefined,
    project: row.project ?? undefined,
    branch: row.branch ?? undefined,
    model: row.model ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    messageCount: row.message_count,
    sourceRef: row.source_ref,
    processedAt: row.processed_at ?? undefined,
    memoryCount: row.memory_count,
    digest: row.digest ?? undefined,
  }
}
