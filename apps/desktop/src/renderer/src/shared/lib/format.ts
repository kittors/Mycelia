/** 展示层的格式化。全部走 Intl，不手搓字符串拼接 */

const DATE_SHORT = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' })
const DATE_FULL = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const RELATIVE = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

export function formatDate(value: number): string {
  const date = new Date(value)
  return date.getFullYear() === new Date().getFullYear()
    ? DATE_SHORT.format(date)
    : DATE_FULL.format(date)
}

export function formatDateTime(value: number): string {
  return DATE_TIME.format(new Date(value))
}

/** 一周以内用相对时间，更久则退回日期 —— 「37 天前」不如「3月2日」好用 */
export function relativeTime(value: number): string {
  const seconds = Math.round((value - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return '刚刚'
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return RELATIVE.format(Math.round(seconds / 3600), 'hour')
  if (abs < 604_800) return RELATIVE.format(Math.round(seconds / 86_400), 'day')
  return formatDate(value)
}

export function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}分钟`
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 路径太长时保留头尾，中间省略 —— 用户认路径靠的是这两端 */
export function truncatePath(path: string, max = 48): string {
  if (path.length <= max) return path
  const head = Math.ceil((max - 1) / 2)
  return `${path.slice(0, head)}…${path.slice(path.length - (max - head - 1))}`
}
