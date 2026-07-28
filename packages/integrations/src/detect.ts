/**
 * agent 安装探测。
 *
 * 「这台机器上装了哪些 agent」不能只看配置目录在不在 —— 用户可能装过又卸了，
 * 目录还留着；也可能刚装完还没跑过，目录尚未生成。
 *
 * 所以两路并查：
 *   1. CLI 可执行文件是否在 PATH 里（最可靠的「装了」证据）
 *   2. 配置目录是否存在（跑过至少一次的证据）
 *
 * 任一命中就算装了。探测结果带上依据，设置页可以据此给出准确提示 ——
 * 「检测到 CLI 但还没跑过」和「完全没装」需要引导用户做的事不一样。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'
import type { InstallTarget } from './types.js'

export interface AgentDetection {
  agent: InstallTarget
  /** 综合判断：装了没有 */
  present: boolean
  /** CLI 可执行文件路径，没找到为 undefined */
  cliPath?: string
  /** CLI 报告的版本号 */
  version?: string
  /** 配置目录是否已生成（说明至少跑过一次） */
  configDirExists: boolean
}

/** 各 agent 的 CLI 命令名与配置根目录 */
const PROBES: Record<InstallTarget, { commands: string[]; configDir: string }> = {
  'claude-code': { commands: ['claude'], configDir: join(homedir(), '.claude') },
  codex: { commands: ['codex'], configDir: join(homedir(), '.codex') },
  opencode: { commands: ['opencode'], configDir: join(homedir(), '.config', 'opencode') },
  pi: { commands: ['pi'], configDir: join(homedir(), '.pi') },
}

/**
 * 在 PATH 里找可执行文件。
 *
 * 用 which/where 而不是自己遍历 PATH：shell 的解析规则（别名、
 * Windows 的 PATHEXT）比想象中复杂，交给系统工具更准。
 */
function findExecutable(command: string): string | undefined {
  const finder = platform() === 'win32' ? 'where' : 'which'
  try {
    const out = execFileSync(finder, [command], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const first = out.split(/\r?\n/).find((line) => line.trim())
    return first?.trim() || undefined
  } catch {
    // 命令不存在时 which/where 以非零码退出，这是预期路径而非异常
    return undefined
  }
}

/** 读版本号。失败不影响主判断，所以静默吞掉 */
function readVersion(cliPath: string): string | undefined {
  try {
    const out = execFileSync(cliPath, ['--version'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // 输出形态各异（有的带前缀有的纯数字），抓第一个 x.y.z 就够
    return out.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0] ?? out.trim().split(/\r?\n/)[0]?.slice(0, 24)
  } catch {
    return undefined
  }
}

export function detectAgent(agent: InstallTarget): AgentDetection {
  const probe = PROBES[agent]
  const configDirExists = existsSync(probe.configDir)

  let cliPath: string | undefined
  for (const command of probe.commands) {
    cliPath = findExecutable(command)
    if (cliPath) break
  }

  return {
    agent,
    present: Boolean(cliPath) || configDirExists,
    cliPath,
    version: cliPath ? readVersion(cliPath) : undefined,
    configDirExists,
  }
}

export function detectAgents(agents: readonly InstallTarget[]): AgentDetection[] {
  return agents.map(detectAgent)
}

/** 配置文件所在目录是否可写入 —— 决定接入按钮能不能点 */
export function canWriteConfig(configPath: string): boolean {
  return existsSync(dirname(configPath))
}
