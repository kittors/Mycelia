/**
 * agent 配置文件的读写。
 *
 * 三种格式（标准 mcpServers JSON、opencode 的 mcp 数组、Codex 的 TOML）
 * 各有各的结构，但共同的要求是一样的：**绝不破坏用户已有的配置**。
 *
 * 所以这里始终是「读出来 → 只改我们那一段 → 写回去」，
 * 解析失败时宁可报错也不覆盖，改动前一律留备份。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** MCP server 在各家配置里的键名 */
export const SERVER_KEY = 'mycelia'

export function patchJson(
  path: string,
  mutate: (root: Record<string, unknown>) => boolean,
): boolean {
  let root: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (!isRecord(parsed)) throw new Error('根节点不是对象')
      root = parsed
    } catch (error) {
      throw new Error(`配置文件不是合法 JSON，拒绝覆盖：${path}`, { cause: error })
    }
  }
  if (!mutate(root)) return false
  backup(path)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 })
  return true
}

export function ensureRecord(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = root[key]
  if (existing === undefined) {
    const value: Record<string, unknown> = {}
    root[key] = value
    return value
  }
  if (!isRecord(existing)) throw new Error(`配置字段 ${key} 必须是对象`)
  return existing
}

export function removeRecordEntry(root: Record<string, unknown>, key: string): boolean {
  const record = root[key]
  if (!isRecord(record) || !(SERVER_KEY in record)) return false
  delete record[SERVER_KEY]
  return true
}

export function patchToml(
  path: string,
  command: string,
  args: string[],
  extraEnv?: Record<string, string>,
): boolean {
  const section = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(command)}`,
    `args = [${args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
    '',
    `[mcp_servers.${SERVER_KEY}.env]`,
    'MYCELIA_CLIENT = "codex"',
    ...Object.entries(extraEnv ?? {}).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
  ].join('\n')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const stripped = stripTomlSection(existing)
  const next = `${stripped.trimEnd()}${stripped.trim() ? '\n\n' : ''}${section}\n`
  if (existing === next) return false
  backup(path)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, next, { mode: 0o600 })
  return true
}

export function removeTomlSection(path: string): boolean {
  if (!existsSync(path)) return false
  const existing = readFileSync(path, 'utf8')
  const stripped = stripTomlSection(existing)
  if (stripped === existing) return false
  backup(path)
  writeFileSync(path, stripped, { mode: 0o600 })
  return true
}

/** 删除 Mycelia 主表及子表，遇到下一个非 Mycelia 表时恢复保留。 */
export function stripTomlSection(content: string): string {
  const out: string[] = []
  let skipping = false
  for (const raw of content.split('\n')) {
    const heading = raw.trim()
    if (heading.startsWith('[')) {
      skipping =
        heading === `[mcp_servers.${SERVER_KEY}]` ||
        heading.startsWith(`[mcp_servers.${SERVER_KEY}.`)
    }
    if (!skipping) out.push(raw)
  }
  return out.join('\n')
}

export function backup(path: string): void {
  if (!existsSync(path)) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  copyFileSync(path, `${path}.mycelia-backup-${stamp}`)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
