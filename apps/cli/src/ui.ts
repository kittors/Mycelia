import { createInterface } from 'node:readline/promises'

/**
 * 终端样式。
 * 不引第三方库 —— chalk 那点功能不值得一个依赖，
 * 而且这样能精确控制「什么时候该关掉颜色」（管道、CI、NO_COLOR）。
 */
const useColor = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

const wrap = (open: number, close: number) => (s: string) =>
  useColor ? `\u001b[${open}m${s}\u001b[${close}m` : s

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  // 菌丝主题色：青绿系
  myc: wrap(38, 39),
}

/** 主题色：真彩终端下用菌丝青绿，否则退回 cyan */
export function accent(s: string): string {
  if (!useColor) return s
  return `\u001b[38;2;94;234;212m${s}\u001b[39m`
}

export const symbols = {
  ok: c.green('✓'),
  fail: c.red('✗'),
  warn: c.yellow('!'),
  info: c.blue('·'),
  arrow: c.gray('→'),
  bullet: c.gray('•'),
}

export function header(title: string): void {
  console.log(`\n${accent('▍')} ${c.bold(title)}`)
}

export function kv(key: string, value: string, indent = 2): void {
  console.log(`${' '.repeat(indent)}${c.gray(key.padEnd(14))}${value}`)
}

export function line(text = ''): void {
  console.log(text)
}

export function success(msg: string): void {
  console.log(`${symbols.ok} ${msg}`)
}

export function warn(msg: string): void {
  console.log(`${symbols.warn} ${c.yellow(msg)}`)
}

export function fail(msg: string): void {
  console.error(`${symbols.fail} ${c.red(msg)}`)
}

/** 表格。列宽自适应，中文按两个字符宽度计算 */
export function table(rows: string[][], opts: { head?: string[] } = {}): void {
  const all = opts.head ? [opts.head, ...rows] : rows
  if (all.length === 0) return

  const cols = Math.max(...all.map((r) => r.length))
  const widths = new Array(cols).fill(0)
  for (const row of all) {
    for (let i = 0; i < cols; i++) widths[i] = Math.max(widths[i], displayWidth(row[i] ?? ''))
  }

  const render = (row: string[], dim = false) =>
    row
      .map((cell, i) => {
        const pad = ' '.repeat(Math.max(0, widths[i] - displayWidth(cell ?? '')))
        const text = `${cell ?? ''}${i === cols - 1 ? '' : pad}`
        return dim ? c.gray(text) : text
      })
      .join('  ')

  if (opts.head) {
    console.log(`  ${render(opts.head, true)}`)
  }
  for (const row of rows) console.log(`  ${render(row)}`)
}

/** 中日韩字符占两列，不算进去表格就会歪 */
export function displayWidth(s: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 需要剥离 ANSI 转义序列
  const stripped = s.replace(/\u001b\[[0-9;]*m/g, '')
  let width = 0
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1
  }
  return width
}

/** 单行进度，跑完自己擦干净 */
export function progress(done: number, total: number, label = ''): void {
  if (!process.stderr.isTTY) return
  const width = 24
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  const filled = Math.round(ratio * width)
  const bar = accent('█'.repeat(filled)) + c.gray('░'.repeat(width - filled))
  const text = `\r  ${bar} ${done}/${total} ${c.gray(label.slice(0, 40))}`
  process.stderr.write(`${text.padEnd(100)}`)
}

export function clearProgress(): void {
  if (process.stderr.isTTY) process.stderr.write(`\r${' '.repeat(100)}\r`)
}

export async function prompt(question: string, opts: { silent?: boolean } = {}): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  try {
    if (!opts.silent) return (await rl.question(`${accent('?')} ${question} `)).trim()

    // 隐藏输入（口令）：临时接管 output 的写入
    const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: unknown }
    let muted = false
    output._writeToOutput = (str: string) => {
      if (!muted || str.includes(question)) output.output.write(str)
    }
    const answered = rl.question(`${accent('?')} ${question} `)
    muted = true
    const value = await answered
    process.stdout.write('\n')
    return value.trim()
  } finally {
    rl.close()
  }
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = (await prompt(`${question} ${c.gray(`[${hint}]`)}`)).toLowerCase()
  if (!answer) return defaultYes
  return answer === 'y' || answer === 'yes'
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 记忆类型的中文名与配色 */
export const KIND_META: Record<string, { label: string; color: (s: string) => string }> = {
  fact: { label: '事实', color: c.blue },
  preference: { label: '偏好', color: c.magenta },
  decision: { label: '决策', color: c.cyan },
  howto: { label: '操作', color: c.green },
  credential: { label: '凭据', color: c.red },
  project: { label: '项目', color: c.yellow },
  learning: { label: '学习', color: c.green },
  issue: { label: '排障', color: c.red },
  insight: { label: '洞察', color: c.magenta },
  entity: { label: '实体', color: c.blue },
}

export function kindBadge(kind: string): string {
  const meta = KIND_META[kind]
  return meta ? meta.color(meta.label) : c.gray(kind)
}
