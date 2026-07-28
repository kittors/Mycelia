/** 工作纪要 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DAY_MS } from '@mycelia/shared'
import { z } from 'zod'
import type { ToolContext } from './context.js'

export function registerDigest(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'digest',
    {
      title: '工作纪要',
      description:
        '汇总一段时间内的工作内容，回答「这周干了啥」「上个月在忙什么」这类问题。按项目分组。',
      inputSchema: {
        days: z.number().int().min(1).max(180).optional().describe('回溯天数，默认 7'),
      },
    },
    async (args) => {
      const days = args.days ?? 7
      const text = await ctx.service.digest(Date.now() - days * DAY_MS)
      return { content: [{ type: 'text', text: `## 最近 ${days} 天\n\n${text}` }] }
    },
  )
}
