/** 检索记忆 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DAY_MS, MemoryKind } from '@mycelia/shared'
import { z } from 'zod'
import { formatMemories, formatSearchSummary } from '../format.js'
import type { ToolContext } from './context.js'

export function registerRecall(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'recall',
    {
      title: '检索记忆',
      description:
        '在用户的长期记忆库中检索。混合了语义向量、关键词与知识图谱扩散三种召回方式。当问题涉及用户的具体环境、历史决策、既有约定时，优先调用它而不是凭空推测。',
      inputSchema: {
        query: z.string().describe('自然语言查询。可以直接用用户的原话'),
        limit: z.number().int().min(1).max(30).optional().describe('返回条数，默认 8'),
        kinds: z
          .array(MemoryKind)
          .optional()
          .describe('限定记忆类型，如 credential 只查凭据、howto 只查操作步骤'),
        tags: z
          .array(z.string())
          .optional()
          .describe('限定标签，支持层级前缀（infra 命中 infra/ssh）'),
        project: z.string().optional().describe('限定项目名'),
        since_days: z.number().int().optional().describe('只看最近 N 天内的记忆'),
      },
    },
    async (args) => {
      const result = await ctx.service.recall({
        text: args.query,
        limit: args.limit ?? 8,
        kinds: args.kinds,
        tags: args.tags,
        project: args.project,
        since: args.since_days ? Date.now() - args.since_days * DAY_MS : undefined,
        includeSecrets: ctx.exposeSecrets,
      })

      const summary = formatSearchSummary(
        args.query,
        result.hits.length,
        result.channels,
        result.durationMs,
      )
      return {
        content: [
          { type: 'text', text: `${summary}\n\n${formatMemories(result.memories, result.hits)}` },
        ],
      }
    },
  )
}
