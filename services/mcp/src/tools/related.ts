/** 关联记忆 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { formatBrief } from '../format.js'
import type { ToolContext } from './context.js'

export function registerRelated(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'related',
    {
      title: '关联记忆',
      description:
        '找出与某条记忆语义相近或在知识图谱上直接相连的其他记忆。用于顺藤摸瓜地展开一个话题 —— 比如查到某台服务器的 SSH 方式后，用它找出这台机器上还跑着什么。',
      inputSchema: {
        id: z.string().describe('起点记忆 ID'),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      const limit = args.limit ?? 8
      const similar = ctx.service.similar(args.id, limit)
      const neighbors = ctx.service.store.edges.neighbors(args.id, limit)
      const neighborIds = neighbors
        .map((e) => (e.sourceId === args.id ? e.targetId : e.sourceId))
        .filter((id) => !similar.some((s) => s.id === id))
      const linked = ctx.service.store.memories.getMany(neighborIds, { decrypt: ctx.exposeSecrets })

      const reasonById = new Map(
        neighbors.map((e) => [
          e.sourceId === args.id ? e.targetId : e.sourceId,
          e.reason ?? e.kind,
        ]),
      )

      const sections = [
        `**语义相近**\n${formatBrief(similar)}`,
        `**图谱直连**\n${
          linked.length === 0
            ? '（无）'
            : linked
                .map((m) => `- [${m.kind}] ${m.title} — ${reasonById.get(m.id) ?? ''}  \`${m.id}\``)
                .join('\n')
        }`,
      ]
      return { content: [{ type: 'text', text: sections.join('\n\n') }] }
    },
  )
}
