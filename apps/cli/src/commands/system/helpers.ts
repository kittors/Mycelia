/** system 命令共用的小工具：进度条、配置路径读写 */

import { c } from '../../ui.js'

export function bar(value: number, total: number): string {
  const width = 20
  const n = total > 0 ? Math.round((value / total) * width) : 0
  return c.gray('▏'.repeat(0)) + '█'.repeat(Math.max(1, n))
}

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj)
}

export function setPath(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  const root: Record<string, unknown> = {}
  let cur = root
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]!] = {}
    cur = cur[keys[i]!] as Record<string, unknown>
  }
  cur[keys.at(-1)!] = value
  return root
}

export function parseValue(v: string): unknown {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null') return null
  const n = Number(v)
  if (!Number.isNaN(n) && v.trim() !== '') return n
  return v
}
