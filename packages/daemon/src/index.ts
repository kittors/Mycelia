import { randomUUID } from 'node:crypto'
import type { MemoryService, PipelineResult } from '@mycelia/core'
import { createWatcher, type Watcher } from '@mycelia/ingest'
import { createLogger } from '@mycelia/shared'

const log = createLogger('daemon')

const LEASE_NAME = 'ingest-pipeline'
/** 租约时长。比单轮流水线的预期耗时长得多，但短到进程崩溃后能被及时接管 */
const LEASE_TTL_MS = 10 * 60 * 1000

export type SchedulerState = 'idle' | 'running' | 'stopped'

export interface SchedulerEvents {
  onStart?: () => void
  onProgress?: (done: number, total: number, current: string) => void
  onComplete?: (result: SyncSummary) => void
  onError?: (error: Error) => void
  onStateChange?: (state: SchedulerState) => void
}

export interface SyncSummary {
  at: number
  conversations: number
  created: number
  pending: number
  merged: number
  edges: number
  llmCalls: number
  tokensUsed: number
  durationMs: number
  errors: string[]
  /** 因为别的进程持有租约而跳过 */
  skippedByLease?: boolean
}

/**
 * 后台调度器。
 *
 * 同时被 Electron 主进程和 `myc daemon` 使用。两者可能同时在跑，
 * 所以用数据库租约做互斥 —— 谁抢到谁干活，另一个跳过这一轮。
 * 这比「检测另一个进程是否存在」可靠得多，也不需要 pid 文件。
 */
export class Scheduler {
  private state: SchedulerState = 'stopped'
  private timer: NodeJS.Timeout | null = null
  private watcher: Watcher | null = null
  private readonly owner = `${process.pid}-${randomUUID().slice(0, 8)}`
  private abortController: AbortController | null = null
  private lastSummary: SyncSummary | null = null

  constructor(
    private readonly service: MemoryService,
    private readonly events: SchedulerEvents = {},
  ) {}

  getState(): SchedulerState {
    return this.state
  }

  getLastSummary(): SyncSummary | null {
    return this.lastSummary
  }

  /** 启动：立即跑一轮，之后按配置周期跑 + 文件变化触发 */
  start(opts: { runImmediately?: boolean; watch?: boolean } = {}): void {
    if (this.state !== 'stopped') return
    this.setState('idle')

    const config = this.service.config
    if (!config.ingest.enabled) {
      log.info('摄取已在配置中关闭，调度器不启动')
      return
    }

    if (opts.watch !== false) {
      this.watcher = createWatcher(config, (paths) => {
        log.debug(`检测到 ${paths.length} 个会话文件变化，触发同步`)
        void this.runOnce()
      })
    }

    const interval = config.ingest.pollIntervalMs
    if (interval > 0) {
      this.timer = setInterval(() => void this.runOnce(), interval)
      this.timer.unref?.()
    }

    if (opts.runImmediately !== false) {
      // 延迟几秒再跑首轮：让应用先把界面渲染出来，别一启动就抢 CPU
      const kickoff = setTimeout(() => void this.runOnce(), 3000)
      kickoff.unref?.()
    }

    log.info(
      `调度器已启动（周期 ${Math.round(interval / 1000)}s，监听 ${this.watcher?.watching.length ?? 0} 个目录）`,
    )
  }

  /** 手动触发一轮同步。并发调用会被合并 —— 正在跑的时候不会重入 */
  async runOnce(opts: { force?: boolean } = {}): Promise<SyncSummary> {
    if (this.state === 'running') {
      log.debug('上一轮同步还在进行，跳过本次触发')
      return this.lastSummary ?? emptySummary()
    }

    // 跨进程互斥
    if (!this.service.store.acquireLease(LEASE_NAME, this.owner, LEASE_TTL_MS)) {
      log.debug('另一个进程正在同步，本轮跳过')
      return { ...emptySummary(), skippedByLease: true }
    }

    this.setState('running')
    this.events.onStart?.()
    this.abortController = new AbortController()
    const started = Date.now()

    try {
      const { ingest, pipeline } = await this.service.sync({
        force: opts.force,
        signal: this.abortController.signal,
        onProgress: this.events.onProgress,
      })

      const summary: SyncSummary = {
        at: Date.now(),
        conversations: ingest.conversations.length,
        created: pipeline.createdMemories,
        pending: pipeline.pendingMemories,
        merged: pipeline.mergedMemories,
        edges: pipeline.edgesCreated,
        llmCalls: pipeline.llmCalls,
        tokensUsed: pipeline.tokensUsed,
        durationMs: Date.now() - started,
        errors: pipeline.errors,
      }

      this.lastSummary = summary
      this.service.store.setMeta('lastSyncAt', String(summary.at))
      this.events.onComplete?.(summary)
      return summary
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      log.error(`同步失败：${error.message}`)
      this.events.onError?.(error)
      return { ...emptySummary(), errors: [error.message], durationMs: Date.now() - started }
    } finally {
      this.service.store.releaseLease(LEASE_NAME, this.owner)
      this.abortController = null
      this.setState('idle')
    }
  }

  /** 取消正在进行的同步 */
  cancel(): void {
    this.abortController?.abort()
  }

  async stop(): Promise<void> {
    this.cancel()
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.watcher?.close()
    this.watcher = null
    this.service.store.releaseLease(LEASE_NAME, this.owner)
    this.setState('stopped')
    log.info('调度器已停止')
  }

  /** 维护任务：清理过期记忆、补齐缺失向量。建议每天跑一次 */
  async maintenance(): Promise<{ purged: number; embedded: number }> {
    const purged = this.service.store.purgeExpired()
    const embedded = await this.service.pipeline.backfillEmbeddings()
    if (purged || embedded) {
      log.info(`维护完成：清理 ${purged} 条过期记忆，补齐 ${embedded} 条向量`)
    }
    return { purged, embedded }
  }

  private setState(state: SchedulerState) {
    if (this.state === state) return
    this.state = state
    this.events.onStateChange?.(state)
  }
}

function emptySummary(): SyncSummary {
  return {
    at: Date.now(),
    conversations: 0,
    created: 0,
    pending: 0,
    merged: 0,
    edges: 0,
    llmCalls: 0,
    tokensUsed: 0,
    durationMs: 0,
    errors: [],
  }
}

export type { PipelineResult }
