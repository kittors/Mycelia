/**
 * 各 agent 的配置位置与 MCP 入口解析。
 *
 * 路径一律写绝对路径 —— agent 的启动 cwd 不可控，相对路径必然出问题。
 */

import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentIntegration } from './types.js'

export function agentIntegrations(): AgentIntegration[] {
  const home = homedir()
  const isWin = platform() === 'win32'
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')

  return [
    { id: 'claude-code', configPath: join(home, '.claude', 'mcp.json'), format: 'json-mcpServers' },
    { id: 'codex', configPath: join(home, '.codex', 'config.toml'), format: 'toml' },
    {
      id: 'opencode',
      configPath: isWin
        ? join(appData, 'opencode', 'opencode.json')
        : join(xdgConfig, 'opencode', 'opencode.json'),
      format: 'json-opencode',
    },
    { id: 'pi', configPath: join(home, '.pi', 'agent', 'mcp.json'), format: 'json-mcpServers' },
  ]
}

export interface ServerEntry {
  command: string
  args: string[]
  /** 需要额外注入的环境变量 */
  env?: Record<string, string>
}

/**
 * MCP server 的启动方式。
 *
 * 关键在于**用注册它的那个运行时去跑它**。
 *
 * better-sqlite3 是原生模块，Electron 与 Node 的 ABI 不兼容（NODE_MODULE_VERSION
 * 分别是 130 和 137），同一份编译产物只能在其中一边加载。桌面应用装的集成如果
 * 写死用 node 启动，agent 一连就报 ABI 不匹配 —— 而这个错误发生在 agent 进程里，
 * 用户只会看到「MCP server 连不上」，完全无从排查。
 *
 * 所以谁注册就用谁的运行时：桌面应用注册就用 Electron（配合
 * ELECTRON_RUN_AS_NODE 让它以纯 Node 模式运行），CLI 注册就用 node。
 * 副产品是用户不必单独装 Node —— 桌面应用自带的 Electron 就够跑。
 *
 * 始终写绝对路径：agent 的启动 cwd 不可控，相对路径必然出问题。
 */
export function resolveServerEntry(opts: { entryPath?: string } = {}): ServerEntry {
  /**
   * 入口优先由调用方给出。
   *
   * 靠 import.meta.url 往上找仓库根只在「本模块以独立文件存在」时成立 ——
   * 桌面应用把整个 workspace bundle 进 out/main 之后，这里算出来的层级就错了，
   * 结果是静默回退到 npx，注册出一个根本起不来的 server。
   * 这种错误要等 agent 连接失败才暴露，排查成本很高。
   */
  const local =
    opts.entryPath ??
    join(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
      'services',
      'mcp',
      'dist',
      'bin.js',
    )

  if (!existsSync(local)) {
    return { command: 'npx', args: ['-y', '@mycelia/mcp-server'] }
  }

  // process.versions.electron 只在 Electron 进程里存在
  const isElectron = Boolean(process.versions.electron)
  return {
    command: process.execPath,
    args: [local],
    env: isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : undefined,
  }
}

export {
  installSkill,
  renderSkill,
  type SkillStatus,
  type SkillTarget,
  skillPath,
  skillStatus,
  uninstallSkill,
} from './skill.js'
