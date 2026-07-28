/**
 * 会话导入、配置、agent 接入与系统能力。
 */

import type { MemoryService } from '@mycelia/core'
import type { Scheduler } from '@mycelia/daemon'
import {
  detectAgents,
  installIntegration,
  integrationStatus,
  skillStatus,
  uninstallIntegration,
  uninstallSkill,
} from '@mycelia/integrations'
import { DAY_MS, dataDir } from '@mycelia/shared'
import { patchConfig } from '@mycelia/store'
import { app, shell } from 'electron'
import { broadcast, type Handle } from './registry.js'

export function registerSystemHandlers(
  handle: Handle,
  service: MemoryService,
  scheduler: Scheduler,
): void {
  // ─────────────────────── 同步 ───────────────────────

  handle('syncNow', async (force = false) => {
    const summary = await scheduler.runOnce({ force })
    broadcast({ type: 'memories:changed' })
    return summary
  })
  handle('cancelSync', () => scheduler.cancel())
  handle('getSyncState', () => ({
    state: scheduler.getState(),
    lastSummary: scheduler.getLastSummary(),
  }))
  handle('rebuildGraph', () => service.rebuildGraph())
  // ─────────────────────── 配置与集成 ───────────────────────

  handle('getConfig', () => service.store.config())
  handle('setConfig', (patch: Record<string, unknown>) => patchConfig(patch as never))
  handle('testLlm', () => service.llm.test())
  handle('getIntegrations', () => {
    const integrations = integrationStatus()
    const skills = skillStatus(integrations.map((item) => item.agent))
    // 探测要跑子进程查 PATH，比读配置文件慢一个量级，所以一次全查完再拼
    const detections = detectAgents(integrations.map((item) => item.agent))

    return integrations.map((item) => {
      const skill = skills.find((s) => s.agent === item.agent)
      const detected = detections.find((d) => d.agent === item.agent)
      return {
        ...item,
        // 探测比「配置目录存在」更可靠：装了但没跑过的 agent 也能被认出来
        agentPresent: detected?.present ?? item.agentPresent,
        cliPath: detected?.cliPath,
        version: detected?.version,
        configDirExists: detected?.configDirExists ?? false,
        skillSupported: skill?.supported ?? false,
        skillInstalled: skill?.installed ?? false,
      }
    })
  })

  handle('installIntegration', (agent: string) => installIntegration(agent))
  handle('uninstallIntegration', (agent: string) => {
    const removed = uninstallIntegration(agent)
    // MCP 拆了，skill 留着只会让 agent 反复调用不存在的工具
    uninstallSkill(agent)
    return removed
  })

  handle('getDigest', (days = 7) => service.digest(Date.now() - days * DAY_MS))

  // ─────────────────────── 系统 ───────────────────────

  handle('openExternal', (url: string) => {
    // 只放行 http(s)，防止 file:// 或自定义协议被利用
    if (!/^https?:\/\//.test(url)) throw new Error('只允许打开 http/https 链接')
    return shell.openExternal(url)
  })
  handle('openPath', (path: string) => shell.openPath(path))
  handle('getPlatform', () => ({
    platform: process.platform,
    dataDir: dataDir(),
    version: app.getVersion(),
  }))
}
