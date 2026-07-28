export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

export interface Logger {
  debug(msg: string, meta?: unknown): void
  info(msg: string, meta?: unknown): void
  warn(msg: string, meta?: unknown): void
  error(msg: string, meta?: unknown): void
  child(scope: string): Logger
}

/**
 * 日志一律写 stderr。
 * 这不是风格问题 —— MCP server 用 stdout 跑 JSON-RPC，
 * 往 stdout 打一个字节就会把协议流搞坏。
 */
function emit(level: LogLevel, scope: string, msg: string, meta?: unknown) {
  const min = (process.env.MYCELIA_LOG_LEVEL as LogLevel) ?? 'info'
  if (LEVEL_ORDER[level] < LEVEL_ORDER[min]) return
  const time = new Date().toISOString().slice(11, 23)
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`
  process.stderr.write(meta === undefined ? `${line}\n` : `${line} ${safeJson(meta)}\n`)
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function createLogger(scope = 'mycelia'): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
    child: (sub) => createLogger(`${scope}:${sub}`),
  }
}
