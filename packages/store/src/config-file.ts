import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Config, ConfigError, configPath, defaultConfig } from '@mycelia/shared'

/**
 * 配置文件读写。
 * 解析失败时不静默回退默认值 —— 那会让用户的自定义配置无声消失。
 * 宁可抛错，让用户知道 config.json 写坏了。
 */
export function loadConfig(path = configPath()): Config {
  if (!existsSync(path)) {
    const cfg = defaultConfig()
    saveConfig(cfg, path)
    return cfg
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new ConfigError(`配置文件不是合法 JSON：${path}`, e)
  }
  const parsed = Config.safeParse(raw)
  if (!parsed.success) {
    throw new ConfigError(`配置文件校验失败：${path}`, parsed.error.flatten())
  }
  return parsed.data
}

export function saveConfig(config: Config, path = configPath()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}

/** 深合并补丁并落盘，返回合并后的完整配置 */
export function patchConfig(patch: DeepPartial<Config>, path = configPath()): Config {
  const merged = deepMerge(loadConfig(path), patch) as Config
  const parsed = Config.parse(merged)
  saveConfig(parsed, path)
  return parsed
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (patch === undefined || patch === null) return base
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue
    const cur = out[k]
    out[k] =
      typeof v === 'object' && v !== null && !Array.isArray(v) && typeof cur === 'object'
        ? deepMerge(cur, v as never)
        : v
  }
  return out as T
}
