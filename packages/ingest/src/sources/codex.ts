import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { ConversationMessage, IngestCursor } from '@mycelia/shared'
import { defaultAgentPaths, projectFromPath, truncate } from '@mycelia/shared'
import { readJsonlFrom } from '../jsonl.js'
import { scanJsonlFiles } from '../scan.js'
import {
  type DiscoverOptions,
  flattenContent,
  isInjectedContent,
  type ReadResult,
  type SessionSource,
  type SourceRef,
} from '../types.js'

/**
 * Codex 的 rollout 文件：
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO时间>-<uuid>.jsonl
 *
 * 坑点：同一条消息会出现两次 —— 一次是 response_item（模型 API 的原始条目），
 * 一次是 event_msg（TUI 渲染事件）。只取 response_item，否则记忆会重复。
 */
interface CodexLine {
  timestamp?: string
  type?: string
  payload?: {
    type?: string
    role?: string
    content?: unknown
    id?: string
    session_id?: string
    cwd?: string
    model?: string
    cli_version?: string
    git?: { branch?: string; repository_url?: string }
  }
}

export class CodexSource implements SessionSource {
  readonly agent = 'codex' as const
  readonly rootPath: string

  constructor(rootPath?: string) {
    this.rootPath = rootPath ?? defaultAgentPaths().codex
  }

  isAvailable(): boolean {
    return existsSync(this.rootPath)
  }

  discover(opts?: DiscoverOptions): Promise<SourceRef[]> {
    return scanJsonlFiles(this.rootPath, this.agent, opts)
  }

  async read(ref: SourceRef, cursor?: IngestCursor): Promise<ReadResult> {
    const { records, offset, truncated } = await readJsonlFrom<CodexLine>(
      ref.ref,
      cursor?.offset ?? 0,
    )
    if (records.length === 0) return { conversation: null, cursor: null }

    const messages: ConversationMessage[] = []
    let sessionId = extractUuid(basename(ref.ref))
    let cwd: string | undefined
    let branch: string | undefined
    let model: string | undefined
    let startedAt = Number.POSITIVE_INFINITY
    let endedAt = 0

    for (const line of records) {
      const p = line.payload
      if (!p) continue

      if (line.type === 'session_meta') {
        sessionId = p.session_id ?? p.id ?? sessionId
        cwd = p.cwd ?? cwd
        model = p.model ?? model
        branch = p.git?.branch ?? branch
        continue
      }
      if (line.type === 'turn_context') {
        cwd = p.cwd ?? cwd
        model = p.model ?? model
        continue
      }

      // 只认 response_item.message，跳过 event_msg 的重复投影
      if (line.type !== 'response_item' || p.type !== 'message') continue
      // developer / system 角色是注入的指令模板，不是对话内容
      if (p.role !== 'user' && p.role !== 'assistant') continue

      const ts = line.timestamp ? Date.parse(line.timestamp) : Date.now()
      const { text, toolName } = flattenContent(p.content)
      if (!text || isInjectedContent(text)) continue

      startedAt = Math.min(startedAt, ts)
      endedAt = Math.max(endedAt, ts)
      messages.push({
        id: p.id ?? `${sessionId}-${messages.length}`,
        role: p.role,
        text,
        timestamp: ts,
        toolName,
      })
    }

    const cursorOut = {
      sourceRef: ref.ref,
      agent: this.agent,
      offset,
      lastModified: ref.modifiedAt,
      lastMessageId: messages.at(-1)?.id,
      messageCount: (truncated ? 0 : (cursor?.messageCount ?? 0)) + messages.length,
    }

    if (messages.length === 0) return { conversation: null, cursor: cursorOut }

    const firstUser = messages.find((m) => m.role === 'user')
    return {
      conversation: {
        id: `codex:${sessionId}`,
        agent: this.agent,
        sessionId,
        title: truncate(firstUser?.text.replace(/\s+/g, ' ').trim() || '未命名会话', 80),
        cwd,
        project: projectFromPath(cwd),
        branch,
        model,
        startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
        endedAt: endedAt || Date.now(),
        messages,
        sourceRef: ref.ref,
      },
      cursor: cursorOut,
    }
  }
}

/** rollout-2026-06-29T23-52-09-019f1414-b709-79f0-b991-b4c85f9cfe8c.jsonl → uuid 部分 */
function extractUuid(filename: string): string {
  const m = filename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return m?.[1] ?? filename.replace(/\.jsonl$/, '')
}
