/** 记忆库概览 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './context.js'

export function registerOverview(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'overview',
    {
      title: '记忆库概览',
      description:
        '查看记忆库里都有些什么：标签分布、涉及的项目与实体。在不确定该用什么关键词检索时，先调它摸清版图。',
      inputSchema: {},
    },
    async () => {
      const stats = ctx.service.store.memories.stats()
      const tags = ctx.service.store.tags.usage().slice(0, 30)
      const entities = ctx.service.store.entities.all(2).slice(0, 20)

      const lines = [
        `共 ${stats.total} 条记忆（待确认 ${stats.pending} 条）`,
        '',
        `**按类型**：${Object.entries(stats.byKind)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k} ${n}`)
          .join(' · ')}`,
        '',
        `**项目**：${Object.entries(stats.byProject)
          .slice(0, 12)
          .map(([k, n]) => `${k}(${n})`)
          .join(' · ')}`,
        '',
        `**标签**：${tags.map((t) => `${t.tag}(${t.count})`).join(' · ')}`,
        '',
        `**实体**：${entities.map((e) => `${e.name}[${e.kind}]`).join(' · ') || '（无）'}`,
      ]
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )
}
