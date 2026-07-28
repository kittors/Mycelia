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

/**
 * 图片等二进制资源。
 *
 * 不塞进数据库：SQLite 存大 blob 会让库文件迅速膨胀，备份、迁移、
 * WAL 检查点全跟着变慢，而这些字节从来不参与查询。放文件系统里，
 * 库里只留一个 asset:// 引用。
 */
/**
 * 应用自己的文档库。
 *
 * 新建的文档默认落在这里，而不是散在系统各处 —— 散着放迟早会被误删，
 * 而且换台机器就找不回来了。挂载外部目录仍然支持，那是「把已有的笔记
 * 接进来」，不是「文档该住哪」。
 *
 * 仍然是普通的 .md 文件、普通的目录：可以用 git 管、可以用别的编辑器开、
 * 卸载应用之后内容还在。数据库只是它的索引。
 */
export function libraryDir(): string {
  return join(dataDir(), 'library')
}

export function assetsDir(): string {
  return join(dataDir(), 'assets')
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
