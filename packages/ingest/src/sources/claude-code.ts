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
 * Claude Code 的落盘结构：
 *   ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl
 *
 * 每行一条记录，混杂了消息、模式切换、文件快照等多种类型。
 * 我们只关心 type 为 user / assistant 的行。
 */
interface ClaudeLine {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  gitBranch?: string
  version?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: {
    role?: string
    content?: unknown
    model?: string
  }
}

export class ClaudeCodeSource implements SessionSource {
  readonly agent = 'claude-code' as const
  readonly rootPath: string

  constructor(rootPath?: string) {
    this.rootPath = rootPath ?? defaultAgentPaths()['claude-code']
  }

  isAvailable(): boolean {
    return existsSync(this.rootPath)
  }

  discover(opts?: DiscoverOptions): Promise<SourceRef[]> {
    return scanJsonlFiles(this.rootPath, this.agent, opts)
  }

  async read(ref: SourceRef, cursor?: IngestCursor): Promise<ReadResult> {
    const { records, offset, truncated } = await readJsonlFrom<ClaudeLine>(
      ref.ref,
      cursor?.offset ?? 0,
    )
    if (records.length === 0) return { conversation: null, cursor: null }

    const sessionId = basename(ref.ref, '.jsonl')
    const messages: ConversationMessage[] = []
    let cwd: string | undefined
    let branch: string | undefined
    let model: string | undefined
    let startedAt = Number.POSITIVE_INFINITY
    let endedAt = 0

    for (const line of records) {
      // sidechain 是子 agent 的独立对话流，会把主线记忆搅乱，跳过
      if (line.isSidechain) continue
      if (line.cwd) cwd = line.cwd
      if (line.gitBranch) branch = line.gitBranch
      if (line.message?.model) model = line.message.model

      if (line.type !== 'user' && line.type !== 'assistant') continue
      if (line.isMeta) continue

      const ts = line.timestamp ? Date.parse(line.timestamp) : Date.now()
      const { text, toolName } = flattenContent(line.message?.content)
      // 系统注入的提醒块不是用户说的话，会污染「用户偏好」类记忆
      if (!text || isInjectedContent(text)) continue

      startedAt = Math.min(startedAt, ts)
      endedAt = Math.max(endedAt, ts)
      messages.push({
        id: line.uuid ?? `${sessionId}-${messages.length}`,
        role: line.type === 'user' ? 'user' : 'assistant',
        text,
        timestamp: ts,
        toolName,
      })
    }

    if (messages.length === 0) {
      return {
        conversation: null,
        cursor: {
          sourceRef: ref.ref,
          agent: this.agent,
          offset,
          lastModified: ref.modifiedAt,
          messageCount: cursor?.messageCount ?? 0,
        },
      }
    }

    const resolvedCwd = cwd ?? decodeCwdSlug(basename(dirname(ref.ref)))
    const firstUser = messages.find((m) => m.role === 'user')

    return {
      conversation: {
        id: `claude-code:${sessionId}`,
        agent: this.agent,
        sessionId,
        title: truncate(firstUser?.text.replace(/\s+/g, ' ').trim() || '未命名会话', 80),
        cwd: resolvedCwd,
        project: projectFromPath(resolvedCwd),
        branch,
        model,
        startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
        endedAt: endedAt || Date.now(),
        messages,
        sourceRef: ref.ref,
      },
      cursor: {
        sourceRef: ref.ref,
        agent: this.agent,
        offset,
        lastModified: ref.modifiedAt,
        lastMessageId: messages.at(-1)?.id,
        messageCount: (truncated ? 0 : (cursor?.messageCount ?? 0)) + messages.length,
      },
    }
  }
}
