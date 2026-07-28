import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { ConversationMessage, IngestCursor } from '@mycelia/shared'
import { defaultAgentPaths, projectFromPath, truncate } from '@mycelia/shared'
import { readJsonlFrom } from '../jsonl.js'
import { decodeCwdSlug, scanJsonlFiles } from '../scan.js'
import {
  type DiscoverOptions,
  flattenContent,
  isInjectedContent,
  type ReadResult,
  type SessionSource,
  type SourceRef,
} from '../types.js'

/**
 * pi 的会话文件：
 *   ~/.pi/agent/sessions/<cwd-slug>/<ISO时间>_<uuid>.jsonl
 *
 * 首行是 `{"type":"session","version":3,"cwd":...}`，
 * 之后是 message / model_change / thinking_level_change 等事件流。
 */
interface PiLine {
  type?: string
  id?: string
  parentId?: string | null
  timestamp?: string
  cwd?: string
  version?: number
  provider?: string
  modelId?: string
  message?: {
    role?: string
    content?: unknown
    timestamp?: number
  }
}

export class PiSource implements SessionSource {
  readonly agent = 'pi' as const
  readonly rootPath: string

  constructor(rootPath?: string) {
    this.rootPath = rootPath ?? defaultAgentPaths().pi
  }

  isAvailable(): boolean {
    return existsSync(this.rootPath)
  }

  discover(opts?: DiscoverOptions): Promise<SourceRef[]> {
    return scanJsonlFiles(this.rootPath, this.agent, opts)
  }

  async read(ref: SourceRef, cursor?: IngestCursor): Promise<ReadResult> {
    const { records, offset, truncated } = await readJsonlFrom<PiLine>(ref.ref, cursor?.offset ?? 0)
    if (records.length === 0) return { conversation: null, cursor: null }

    const fileName = basename(ref.ref, '.jsonl')
    let sessionId = fileName.includes('_') ? fileName.split('_').slice(1).join('_') : fileName
    const messages: ConversationMessage[] = []
    let cwd: string | undefined
    let model: string | undefined
    let startedAt = Number.POSITIVE_INFINITY
    let endedAt = 0

    for (const line of records) {
      if (line.type === 'session') {
        sessionId = line.id ?? sessionId
        cwd = line.cwd ?? cwd
        continue
      }
      if (line.type === 'model_change') {
        model = line.modelId ?? model
        continue
      }
      if (line.type !== 'message') continue

      const role = line.message?.role
      if (role !== 'user' && role !== 'assistant') continue

      const ts = line.timestamp
        ? Date.parse(line.timestamp)
        : (line.message?.timestamp ?? Date.now())
      const { text, toolName } = flattenContent(line.message?.content)
      if (!text || isInjectedContent(text)) continue

      startedAt = Math.min(startedAt, ts)
      endedAt = Math.max(endedAt, ts)
      messages.push({
        id: line.id ?? `${sessionId}-${messages.length}`,
        role,
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

    const resolvedCwd = cwd ?? decodeCwdSlug(basename(dirname(ref.ref)))
    const firstUser = messages.find((m) => m.role === 'user')

    return {
      conversation: {
        id: `pi:${sessionId}`,
        agent: this.agent,
        sessionId,
        title: truncate(firstUser?.text.replace(/\s+/g, ' ').trim() || '未命名会话', 80),
        cwd: resolvedCwd,
        project: projectFromPath(resolvedCwd),
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
