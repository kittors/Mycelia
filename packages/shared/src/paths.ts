import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/**
 * 跨平台数据目录。
 * 遵守各平台惯例，而不是无脑塞 ~/.mycelia —— Windows 用户尤其在意这一点。
 *   macOS   ~/Library/Application Support/Mycelia
 *   Windows %APPDATA%\Mycelia
 *   Linux   $XDG_DATA_HOME/mycelia 或 ~/.local/share/mycelia
 * 可用 MYCELIA_HOME 环境变量整体覆盖（测试与便携部署靠它）。
 */
export function dataDir(): string {
  const override = process.env.MYCELIA_HOME
  if (override) return override

  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Mycelia')
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Mycelia')
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'mycelia')
  }
}

export function configPath(): string {
  return join(dataDir(), 'config.json')
}

export function databasePath(): string {
  return join(dataDir(), 'mycelia.db')
}

/** 本地嵌入模型缓存目录 */
export function modelCacheDir(): string {
  return join(dataDir(), 'models')
}

export function logDir(): string {
  return join(dataDir(), 'logs')
}

/** 各 agent 默认的会话存储位置 —— ingest 适配器的默认扫描根 */
export function defaultAgentPaths() {
  const home = homedir()
  const xdgData = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share')
  const isWin = platform() === 'win32'
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')

  return {
    'claude-code': join(home, '.claude', 'projects'),
    codex: join(home, '.codex', 'sessions'),
    pi: join(home, '.pi', 'agent', 'sessions'),
    // opencode 在 Windows 走 APPDATA，其余平台走 XDG
    opencode: isWin
      ? join(appData, 'opencode', 'opencode.db')
      : join(xdgData, 'opencode', 'opencode.db'),
  } as const
}
