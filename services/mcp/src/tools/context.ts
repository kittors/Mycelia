/**
 * 工具注册的共享上下文。
 *
 * 每个工具都需要 service，多数还需要知道「能不能看密钥」「调用方是谁」。
 * 打包成一个对象传，比给每个注册函数排四个参数好维护。
 */

import type { MemoryService } from '@mycelia/core'

export interface ToolContext {
  service: MemoryService
  /** 允许返回 secret 记忆明文。默认关闭 —— 密钥不该随便流向任意 agent */
  exposeSecrets: boolean
  /** 调用方标识，写进记忆来源 */
  clientName: string
}
