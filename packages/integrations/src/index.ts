/**
 * agent 接入。
 *
 * 接入做两件事：注册 MCP server 让 agent **能**读写记忆，
 * 安装 skill 让它**记得**用。前者是能力，后者是时机 —— 缺了哪个都不好使。
 *
 *   types.ts        接入目标与状态的类型
 *   paths.ts        各 agent 的配置位置
 *   config-file.ts  三种配置格式的安全读写
 *   skill.ts        skill 文件的生成与安装
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ensureRecord,
  isRecord,
  patchJson,
  patchToml,
  removeRecordEntry,
  removeTomlSection,
  SERVER_KEY,
} from './config-file.js'
import { agentIntegrations, resolveServerEntry } from './paths.js'
import { installSkill } from './skill.js'
import type { AgentIntegration, IntegrationOptions, IntegrationStatus } from './types.js'

export { type AgentDetection, canWriteConfig, detectAgent, detectAgents } from './detect.js'
export { agentIntegrations, resolveServerEntry, type ServerEntry } from './paths.js'
export {
  installSkill,
  renderSkill,
  type SkillStatus,
  type SkillTarget,
  skillPath,
  skillStatus,
  uninstallSkill,
} from './skill.js'
export type {
  AgentIntegration,
  InstallTarget,
  IntegrationFormat,
  IntegrationOptions,
  IntegrationStatus,
} from './types.js'

export function installIntegration(target: string, opts: IntegrationOptions = {}): boolean {
  const integration = findIntegration(target, opts.integrations)
  if (!existsSync(dirname(integration.configPath))) {
    throw new Error(`${target} 未安装或配置目录不存在：${dirname(integration.configPath)}`)
  }
  const entry = opts.serverEntry ?? resolveServerEntry()
  const args = opts.readOnly ? [...entry.args, '--read-only'] : entry.args

  const changed = writeServerConfig(integration, entry.command, args, entry.env)

  // 顺带装上 skill：挂了 MCP 只是「能用」，skill 才让 agent 记得用。
  // 该 agent 没有 skill 机制、或目录不可写时静默跳过 —— 这不影响 MCP 已经装好。
  if (opts.skill !== false) {
    try {
      installSkill(integration.id)
    } catch {
      /* skill 是增益不是前提 */
    }
  }

  return changed
}

function writeServerConfig(
  integration: AgentIntegration,
  command: string,
  args: string[],
  extraEnv?: Record<string, string>,
): boolean {
  switch (integration.format) {
    case 'json-mcpServers':
      return patchJson(integration.configPath, (root) => {
        const servers = ensureRecord(root, 'mcpServers')
        const next = {
          command,
          args,
          env: { MYCELIA_CLIENT: integration.id, ...extraEnv },
        }
        if (JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(next)) return false
        servers[SERVER_KEY] = next
        return true
      })
    case 'json-opencode':
      return patchJson(integration.configPath, (root) => {
        const mcp = ensureRecord(root, 'mcp')
        const next = {
          type: 'local',
          command: [command, ...args],
          enabled: true,
          environment: { MYCELIA_CLIENT: 'opencode', ...extraEnv },
        }
        if (JSON.stringify(mcp[SERVER_KEY]) === JSON.stringify(next)) return false
        mcp[SERVER_KEY] = next
        return true
      })
    case 'toml':
      return patchToml(integration.configPath, command, args, extraEnv)
  }
}

export function uninstallIntegration(target: string, integrations?: AgentIntegration[]): boolean {
  const integration = findIntegration(target, integrations)
  switch (integration.format) {
    case 'json-mcpServers':
      return patchJson(integration.configPath, (root) => removeRecordEntry(root, 'mcpServers'))
    case 'json-opencode':
      return patchJson(integration.configPath, (root) => removeRecordEntry(root, 'mcp'))
    case 'toml':
      return removeTomlSection(integration.configPath)
  }
}

export function integrationStatus(integrations = agentIntegrations()): IntegrationStatus[] {
  return integrations.map((integration) => {
    let installed = false
    if (existsSync(integration.configPath)) {
      const raw = readFileSync(integration.configPath, 'utf8')
      if (integration.format === 'toml') {
        installed = raw.split(/\r?\n/).some((line) => line.trim() === `[mcp_servers.${SERVER_KEY}]`)
      } else {
        try {
          const root = JSON.parse(raw) as Record<string, unknown>
          const key = integration.format === 'json-opencode' ? 'mcp' : 'mcpServers'
          installed = isRecord(root[key]) && SERVER_KEY in root[key]
        } catch {
          installed = false
        }
      }
    }
    return {
      agent: integration.id,
      configPath: integration.configPath,
      installed,
      agentPresent: existsSync(dirname(integration.configPath)),
    }
  })
}

function findIntegration(target: string, integrations = agentIntegrations()): AgentIntegration {
  const normalized = target === 'claude' ? 'claude-code' : target
  const integration = integrations.find((item) => item.id === normalized)
  if (!integration) throw new Error(`无法识别的 agent：${target}`)
  return integration
}
