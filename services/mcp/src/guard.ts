import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { redact } from '@mycelia/crypto'

/**
 * 交给 agent 之前抹掉凭据。
 *
 * 与 llm 层那道闸是同一个道理，只是出口不同：那边是内容离开本机去模型，
 * 这边是内容离开 Mycelia 进入 agent 的上下文 —— 而 agent 的上下文马上
 * 就会被发给它自己那个模型，还会写进会话记录、留在别人的日志里。
 *
 * 包在 registerTool 上而不是各个工具里：工具会一个个加，写工具、检索工具、
 * 摘要工具……每处各写一遍脱敏迟早漏一处，而漏掉的那次没有任何症状。
 * 把它放在所有工具都必经的那一层，就不存在「新工具忘了加」。
 *
 * 用户自己在 Mycelia 界面里看到的仍是原文 —— 那没有离开这台机器。
 */
export function guardTools(server: McpServer): McpServer {
  const original = server.registerTool.bind(server)

  // biome-ignore lint/suspicious/noExplicitAny: 要透明地裹住 SDK 的重载签名，只能放开类型
  ;(server as any).registerTool = (name: string, config: unknown, handler: any) =>
    original(
      name,
      config as never,
      (async (...args: unknown[]) => {
        const result = await handler(...args)
        return scrub(result)
      }) as never,
    )

  return server
}

/** 递归处理返回结构里所有的文本字段 */
function scrub<T>(result: T): T {
  if (typeof result === 'string') return redact(result).text as T
  if (Array.isArray(result)) return result.map(scrub) as T
  if (result && typeof result === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(result)) out[key] = scrub(value)
    return out as T
  }
  return result
}
