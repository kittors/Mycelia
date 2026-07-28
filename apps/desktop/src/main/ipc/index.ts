/**
 * 主进程 IPC。
 *
 * 按领域分文件，每个文件注册自己那一组通道：
 *
 *   memory.ts     记忆的检索、读取、写入
 *   knowledge.ts  文件目录知识库
 *   dashboard.ts  概览与时间线的聚合查询
 *   vault.ts      保险箱
 *   system.ts     导入、配置、agent 接入、系统能力
 *
 * 通道名与参数类型由 shared/ipc-contract.ts 约束 ——
 * 写错通道名或少传参数会在编译期报错，而不是运行时静默失败。
 */

import type { MemoryService } from '@mycelia/core'
import type { Scheduler } from '@mycelia/daemon'
import { registerDashboardHandlers } from './dashboard.js'
import { registerKnowledgeHandlers } from './knowledge.js'
import { registerMemoryHandlers } from './memory.js'
import { createHandle } from './registry.js'
import { registerSystemHandlers } from './system.js'
import { registerVaultHandlers } from './vault.js'

export { broadcast } from './registry.js'

export function registerHandlers(service: MemoryService, scheduler: Scheduler): void {
  const handle = createHandle()

  registerMemoryHandlers(handle, service)
  registerKnowledgeHandlers(handle, service)
  registerDashboardHandlers(handle, service)
  registerVaultHandlers(handle, service)
  registerSystemHandlers(handle, service, scheduler)
}
