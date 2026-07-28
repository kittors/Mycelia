/** 检索文档库 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { formatDocumentHits } from '../format.js'
import type { ToolContext } from './context.js'

export function registerSearchDocs(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'search_docs',
    {
      title: '检索文档库',
      description:
        '在用户挂载的本地文档目录（笔记、规范、设计文档）里做语义检索。与 recall 的区别：recall 查的是沉淀下来的结论，这里查的是原始文档原文。当用户提到「我的笔记」「文档里写过」或需要引用原文时用它。',
      inputSchema: {
        query: z.string().describe('自然语言查询'),
        limit: z.number().int().min(1).max(20).optional().describe('返回条数，默认 5'),
        source_ids: z.array(z.string()).optional().describe('限定知识源，不传则搜索全部'),
      },
    },
    async (args) => {
      const hits = await ctx.service.searchDocuments(args.query, {
        limit: args.limit ?? 5,
        sourceIds: args.source_ids,
      })

      if (hits.length === 0) {
        const sourceCount = ctx.service.store.sources.all().length
        return {
          content: [
            {
              type: 'text',
              text:
                sourceCount === 0
                  ? '尚未挂载任何文档目录。用户可以在 Mycelia 桌面端「知识库」里添加。'
                  : `未检索到相关文档（已索引 ${ctx.service.store.chunks.count()} 个片段）。`,
            },
          ],
        }
      }

      return { content: [{ type: 'text', text: formatDocumentHits(args.query, hits) }] }
    },
  )
}
