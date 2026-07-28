/**
 * Mycelia MCP server。
 *
 * 这是记忆的主入口：agent 通过它检索既有知识、写回新的沉淀。
 * 服务本身很薄 —— 建 server、注册工具、接 transport，
 * 具体工具在 tools/ 下一个文件一个。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { MemoryService } from '@mycelia/core'
import { createLogger } from '@mycelia/shared'
import { registerTools, SERVER_INSTRUCTIONS, type ToolContext } from './tools/index.js'

const log = createLogger('mcp')

export interface McpServerOptions {
  service: MemoryService
  /** 允许 agent 写入记忆。只读模式下 remember/forget 不注册 */
  allowWrite?: boolean
  /** 允许返回 secret 记忆明文。默认关闭 —— 密钥不该随便流向任意 agent */
  exposeSecrets?: boolean
  /** 调用方标识，写进记忆来源 */
  clientName?: string
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const allowWrite = opts.allowWrite ?? true
  const exposeSecrets = opts.exposeSecrets ?? false

  const server = new McpServer(
    { name: 'mycelia', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  )

  const context: ToolContext = {
    service: opts.service,
    exposeSecrets,
    clientName: opts.clientName ?? 'unknown',
  }

  registerTools(server, context, { allowWrite })

  log.debug(
    `MCP server 已构建（写入 ${allowWrite ? '开' : '关'}，密钥暴露 ${exposeSecrets ? '开' : '关'}）`,
  )
  return server
}

/**
 * 以 stdio 模式启动并阻塞。
 *
 * CLI 的 `myc serve` 直接调它 —— transport 的选择属于本包的实现细节，
 * 不该泄漏到调用方。
 */
export async function startStdioServer(opts: McpServerOptions): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const server = createMcpServer(opts)
  await server.connect(new StdioServerTransport())
  log.info(`Mycelia MCP server 已就绪（${opts.allowWrite === false ? '只读' : '读写'}）`)

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void server.close().finally(resolve)
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}
