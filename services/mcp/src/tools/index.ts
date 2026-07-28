/**
 * MCP 工具集。
 *
 * 工具列表是 agent 的稀缺资源 —— 每多一个都在消耗它的注意力。
 * 所以这里只暴露真正高频的能力，管理类操作（编辑、合并、改标签）
 * 一律留给桌面端。
 *
 * 一个工具一个文件：改某个工具的描述或参数时，
 * 不必在一坨几百行的注册代码里翻找。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './context.js'
import { registerDigest } from './digest.js'
import { registerOverview } from './overview.js'
import { registerRecall } from './recall.js'
import { registerRelated } from './related.js'
import { registerWriteTools } from './remember.js'
import { registerSearchDocs } from './search-docs.js'

export type { ToolContext } from './context.js'
export { SERVER_INSTRUCTIONS } from './instructions.js'

/**
 * 注册全部工具。
 *
 * 只读模式下不注册 remember/forget —— 与其让 agent 调用后收到「无权限」，
 * 不如让它一开始就看不见这两个工具。
 */
export function registerTools(
  server: McpServer,
  ctx: ToolContext,
  opts: { allowWrite: boolean },
): void {
  registerRecall(server, ctx)
  registerSearchDocs(server, ctx)
  registerRelated(server, ctx)
  registerDigest(server, ctx)
  registerOverview(server, ctx)

  if (opts.allowWrite) {
    registerWriteTools(server, ctx)
  }
}
