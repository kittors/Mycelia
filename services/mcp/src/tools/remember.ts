/** 写入与删除 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MemoryKind, Sensitivity } from '@mycelia/shared'
import { z } from 'zod'
import { renderCaptureOutcome } from '../format.js'
import type { ToolContext } from './context.js'

export function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'remember',
    {
      title: '记住',
      description:
        '把一条知识写入长期记忆库，跨会话、跨 agent 永久可用。只在信息具备长期价值时调用 —— 三个月后再看依然有用才值得记。不要记录一次性的临时状态。',
      inputSchema: {
        title: z.string().max(120).describe('一句话标题，脱离上下文也能看懂'),
        content: z.string().describe('完整内容。必须自包含，不要出现「上面提到的」这类指代'),
        kind: MemoryKind.describe(
          'fact 事实 / preference 用户偏好 / decision 决策 / howto 操作步骤 / credential 凭据 / project 项目进展 / learning 学习 / issue 排障 / insight 洞察 / entity 实体档案',
        ),
        tags: z.array(z.string()).optional().describe('层级标签，如 infra/ssh、dev/frontend'),
        sensitivity: Sensitivity.optional().describe(
          '含密钥密码一律 secret（会加密存储）；内部信息 private；通用知识 public',
        ),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('长期价值 0~1，用户明确要求记住的给 0.9'),
        project: z.string().optional().describe('归属项目'),
        user_requested: z
          .boolean()
          .optional()
          .describe(
            '用户是否明确要求记住这条。为 true 时跳过价值把关直接写入 —— 只有用户原话表达了「记住」的意思才置 true，不要替用户做主',
          ),
      },
    },
    async (args) => {
      try {
        const { decision, memory } = await ctx.service.capture(
          {
            kind: args.kind,
            title: args.title,
            content: args.content,
            tags: args.tags ?? [],
            sensitivity: args.sensitivity ?? 'private',
            importance: args.importance ?? 0.7,
            project: args.project,
          },
          {
            // 用户原话就是「记住 X」时跳过把关 —— 他的判断优先于模型的
            force: args.user_requested ?? false,
            captureMode: 'agent',
            actor: `mcp:${ctx.clientName}`,
            origin: {
              agent: 'mcp',
              project: args.project,
              excerpt: `由 ${ctx.clientName} 写入`,
            },
          },
        )

        // 把判断结果如实回给 agent：被拒时它需要知道原因，
        // 否则下一轮还会用同样的内容重试
        const text = renderCaptureOutcome(decision, memory)
        return { content: [{ type: 'text', text }] }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // 最常见的失败：保险箱上锁时写 secret
        return {
          content: [{ type: 'text', text: `写入失败：${msg}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'forget',
    {
      title: '删除记忆',
      description: '按 ID 删除一条记忆。只在用户明确要求时调用。',
      inputSchema: {
        id: z.string().describe('记忆 ID，来自 recall 返回结果'),
      },
    },
    async (args) => ({
      content: [
        {
          type: 'text',
          text: ctx.service.forget(args.id, `mcp:${ctx.clientName}`)
            ? `已删除 ${args.id}`
            : `未找到 ${args.id}`,
        },
      ],
    }),
  )
}
