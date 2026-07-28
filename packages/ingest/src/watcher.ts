import { existsSync } from 'node:fs'
import type { Config } from '@mycelia/shared'
import { createLogger, defaultAgentPaths } from '@mycelia/shared'
import chokidar, { type FSWatcher } from 'chokidar'

const log = createLogger('ingest:watch')

export interface Watcher {
  close(): Promise<void>
  readonly watching: string[]
}

/**
 * 文件监听。
 *
 * 会话文件在对话过程中是持续追加的，如果每次 change 都触发一轮摄取，
 * 一次对话能触发上百次。所以这里做防抖聚合：静默 N 毫秒后才回调一次。
 */
export function createWatcher(
  config: Config,
  onChange: (paths: string[]) => void,
  debounceMs = 5000,
): Watcher {
  const s = config.ingest.sources
  const defaults = defaultAgentPaths()

  const targets = [
    s['claude-code'].enabled ? (s['claude-code'].path ?? defaults['claude-code']) : null,
    s.codex.enabled ? (s.codex.path ?? defaults.codex) : null,
    s.pi.enabled ? (s.pi.path ?? defaults.pi) : null,
    // opencode 是单个 db 文件，直接监听文件本身
    s.opencode.enabled ? (s.opencode.path ?? defaults.opencode) : null,
  ].filter((p): p is string => Boolean(p) && existsSync(p as string))

  if (targets.length === 0) {
    return { close: async () => {}, watching: [] }
  }

  const pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null

  const flush = () => {
    timer = null
    if (pending.size === 0) return
    const paths = [...pending]
    pending.clear()
    try {
      onChange(paths)
    } catch (e) {
      log.error('监听回调抛错', String(e))
    }
  }

  const watcher: FSWatcher = chokidar.watch(targets, {
    // 忽略初始扫描事件：启动时的全量摄取由 IngestService 主动跑，不走这里
    ignoreInitial: true,
    persistent: true,
    depth: 6,
    // SQLite 的 -wal 文件变化太频繁，只认主库文件与 jsonl
    ignored: (path: string) => path.endsWith('-wal') || path.endsWith('-shm'),
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 300 },
  })

  watcher.on('all', (event, path) => {
    if (event !== 'add' && event !== 'change') return
    pending.add(path)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
    timer.unref?.()
  })

  watcher.on('error', (e) => log.warn('监听错误', String(e)))
  log.info(`已监听 ${targets.length} 个会话目录`)

  return {
    watching: targets,
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    },
  }
}
