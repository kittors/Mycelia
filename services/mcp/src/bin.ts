#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { MemoryService } from '@mycelia/core'
import { createLogger } from '@mycelia/shared'
import { createMcpServer } from './index.js'

const log = createLogger('mcp:bin')

/**
 * MCP server 入口（stdio）。
 *
 * 铁律：stdout 属于 JSON-RPC，任何一个字节的杂音都会让协议流失效。
 * 所以全项目的日志都走 stderr（见 @mycelia/shared/logger）。
 */
async function main() {
  const args = new Set(process.argv.slice(2))

  const service = MemoryService.open()

  // 只读模式：给不信任的 agent 用，或者用户不想让 agent 往记忆库里写
  const allowWrite = !args.has('--read-only')
  // 默认不暴露密钥明文。需要时显式开启，并且保险箱还得是解锁状态
  const exposeSecrets = args.has('--expose-secrets')

  const server = createMcpServer({
    service,
    allowWrite,
    exposeSecrets,
    clientName: process.env.MYCELIA_CLIENT ?? 'stdio',
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  log.info(`Mycelia MCP server 已就绪（${allowWrite ? '读写' : '只读'}）`)

  const shutdown = async () => {
    await server.close().catch(() => {})
    service.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  log.error(`启动失败：${e instanceof Error ? e.stack : String(e)}`)
  process.exit(1)
})
