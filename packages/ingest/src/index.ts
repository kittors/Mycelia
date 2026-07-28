import type { AgentSource, Config, Conversation } from '@mycelia/shared'
import { createLogger, DAY_MS } from '@mycelia/shared'
import type { MyceliaStore } from '@mycelia/store'
import { ClaudeCodeSource } from './sources/claude-code.js'
import { CodexSource } from './sources/codex.js'
import { OpencodeSource } from './sources/opencode.js'
import { PiSource } from './sources/pi.js'
import type { SessionSource } from './types.js'

const log = createLogger('ingest')

export interface IngestResult {
  /** 本轮新读到的会话（已写入 conversations 表） */
  conversations: Conversation[]
  scannedSources: number
  changedSources: number
  byAgent: Record<string, number>
  durationMs: number
}

export interface IngestOptions {
  /** 只摄取指定 agent */
  agents?: AgentSource[]
  /** 覆盖回溯天数 */
  lookbackDays?: number
  /** 单轮最多处理多少个源，避免首次运行卡死 */
  maxSources?: number
  /** 忽略游标，从头重读 */
  force?: boolean
}

/**
 * 摄取服务。
 *
 * 职责边界很明确：只负责「把各家 agent 的会话读进来并登记」，
 * 不做任何记忆提取 —— 那是 @mycelia/core 的事。
 * 这样即使提取逻辑（LLM prompt）反复迭代，摄取层也不用动。
 */
export class IngestService {
  private readonly sources: SessionSource[]

  constructor(
    private readonly store: MyceliaStore,
    config: Config,
  ) {
    const s = config.ingest.sources
    const all: Array<[boolean, SessionSource]> = [
      [s['claude-code'].enabled, new ClaudeCodeSource(s['claude-code'].path)],
      [s.codex.enabled, new CodexSource(s.codex.path)],
      [s.opencode.enabled, new OpencodeSource(s.opencode.path)],
      [s.pi.enabled, new PiSource(s.pi.path)],
    ]
    this.sources = all.filter(([enabled]) => enabled).map(([, src]) => src)
  }

  /** 本机装了哪些 agent —— `myc doctor` 和桌面端首屏用它 */
  availability(): Array<{ agent: AgentSource; available: boolean; path: string }> {
    return this.sources.map((s) => ({
      agent: s.agent,
      available: s.isAvailable(),
      path: s.rootPath,
    }))
  }

  async run(config: Config, opts: IngestOptions = {}): Promise<IngestResult> {
    const started = Date.now()
    const lookback = opts.lookbackDays ?? config.ingest.lookbackDays
    const since = lookback > 0 ? started - lookback * DAY_MS : 0
    const conversations: Conversation[] = []
    const byAgent: Record<string, number> = {}
    let scanned = 0
    let changed = 0

    for (const source of this.sources) {
      if (opts.agents && !opts.agents.includes(source.agent)) continue
      if (!source.isAvailable()) {
        log.debug(`${source.agent} 不可用，跳过：${source.rootPath}`)
        continue
      }

      let refs: Awaited<ReturnType<SessionSource['discover']>>
      try {
        refs = await source.discover({
          since,
          excludePaths: config.ingest.excludePaths,
          limit: opts.maxSources,
        })
      } catch (e) {
        log.warn(`${source.agent} 扫描失败`, String(e))
        continue
      }
      scanned += refs.length

      for (const ref of refs) {
        const cursor = opts.force ? undefined : this.store.cursors.get(ref.ref)
        // 文件没动过就跳过：这是首次运行之后的常态，占绝大多数
        if (cursor && !opts.force && cursor.lastModified >= ref.modifiedAt) continue

        try {
          const result = await source.read(ref, cursor)
          if (result.cursor) {
            this.store.cursors.save(result.cursor)
            changed++
          }
          if (result.conversation && result.conversation.messages.length > 0) {
            this.store.conversations.upsert(result.conversation)
            conversations.push(result.conversation)
            byAgent[source.agent] = (byAgent[source.agent] ?? 0) + 1
          }
        } catch (e) {
          log.warn(`读取失败 ${ref.ref}`, String(e))
        }
      }
    }

    const durationMs = Date.now() - started
    log.info(
      `摄取完成：扫描 ${scanned} 个源，${changed} 个有更新，产出 ${conversations.length} 个会话，耗时 ${durationMs}ms`,
    )
    return { conversations, scannedSources: scanned, changedSources: changed, byAgent, durationMs }
  }

  close(): void {
    for (const s of this.sources) {
      if (s instanceof OpencodeSource) s.close()
    }
  }
}

export * from './jsonl.js'
export * from './scan.js'
export * from './types.js'
export { createWatcher, type Watcher } from './watcher.js'
export { ClaudeCodeSource, CodexSource, OpencodeSource, PiSource }
