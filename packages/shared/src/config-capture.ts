/**
 * 写入把关相关的配置：会话摄取、提取、价值判断。
 *
 * 这几块共同决定「什么东西配得上被长期记住」，是这个产品最核心的判断逻辑，
 * 参数改动的影响也最直接 —— 放在一起便于对照着调。
 */

import { z } from 'zod'

/**
 * 会话日志导入 —— **不是**主路径，默认关闭。
 *
 * 记忆的正常来源是 agent 通过 MCP 的 remember 主动写入：它在对话里判断
 * 什么值得长期留存，然后只写这一条。把本地会话日志整个扒一遍是相反的思路，
 * 会把大量一次性上下文灌进知识库，检索质量反而被稀释。
 *
 * 这里保留它，是为了让用户能一次性回捞历史沉淀（「我用了半年 Claude Code，
 * 之前的东西不想丢」）。它是用户手动触发的导入动作，不是后台常驻的抓取。
 */
export const IngestConfig = z.object({
  enabled: z.boolean().default(false),
  /** 每个 agent 单独开关 + 自定义路径 */
  sources: z
    .object({
      'claude-code': z.object({ enabled: z.boolean().default(true), path: z.string().optional() }),
      codex: z.object({ enabled: z.boolean().default(true), path: z.string().optional() }),
      opencode: z.object({ enabled: z.boolean().default(true), path: z.string().optional() }),
      pi: z.object({ enabled: z.boolean().default(true), path: z.string().optional() }),
    })
    .default({
      'claude-code': { enabled: true },
      codex: { enabled: true },
      opencode: { enabled: true },
      pi: { enabled: true },
    }),
  /** 轮询间隔（毫秒）。文件监听之外的兜底扫描 */
  pollIntervalMs: z.number().int().default(60_000),
  /** 只处理最近 N 天的会话，避免首次启动就啃完几个 G 的历史 */
  lookbackDays: z.number().int().default(30),
  /** 会话至少要有这么多条消息才值得提取记忆 */
  minMessages: z.number().int().default(4),
  /** 排除这些目录下的会话（临时目录、worktree 之类） */
  excludePaths: z.array(z.string()).default(['/private/tmp', '/tmp']),
})
export type IngestConfig = z.infer<typeof IngestConfig>

export const ExtractionConfig = z.object({
  /** 低于此置信度的记忆进 pending 队列，等用户在桌面端确认 */
  autoAcceptThreshold: z.number().min(0).max(1).default(0.75),
  /** 单次会话最多提取多少条记忆，防止 LLM 话痨 */
  maxMemoriesPerConversation: z.number().int().default(12),
  /** 相似度高于此值视为重复，走合并而非新建 */
  dedupeThreshold: z.number().min(0).max(1).default(0.92),
  /** 检测到凭据类内容时，是否直接存为 secret（强烈建议开启） */
  redactCredentials: z.boolean().default(true),
})
export type ExtractionConfig = z.infer<typeof ExtractionConfig>

/**
 * 主动记忆的准入策略 —— 决定 agent 递过来的东西够不够格进知识库。
 *
 * 「不是什么都要进知识库」这条产品原则，最终要落成可执行的规则，
 * 否则接了 MCP 的 agent 会把每次对话的边角料都塞进来。
 */
export const CaptureConfig = z.object({
  /** 低于此长度的内容直接拒绝 —— 「好的」「已修复」这类没有留存价值 */
  minContentLength: z.number().int().default(24),
  /**
   * 与既有记忆相似度高于此值时，走更新而不是新建。
   * 比 extraction.dedupeThreshold 松一些：主动写入通常是对旧知识的修订。
   */
  supersedeThreshold: z.number().min(0).max(1).default(0.88),
  /** 单个 agent 会话最多写入多少条，防止某次对话刷屏 */
  maxPerSession: z.number().int().default(8),
  /**
   * 由 LLM 二次把关：判断这条内容是否具备跨会话的长期价值。
   * 关掉后只跑长度与去重这类硬规则，写入更快但更容易进噪音。
   */
  llmGatekeeper: z.boolean().default(true),
  /** 未通过把关的写入是否留在待审队列，而不是静默丢弃 */
  queueRejected: z.boolean().default(true),
})
export type CaptureConfig = z.infer<typeof CaptureConfig>

/**
 * 文件目录知识库 —— 三层知识库里的最底层。
 *
 * 指向用户本地的文档目录（笔记、规范、设计文档），文件内容按块索引进 RAG。
 * 与记忆层的区别：这里是**只读镜像**，用户在编辑器里改文件，Mycelia 负责跟随，
 * 从不反向写回。文件才是事实来源。
 */
