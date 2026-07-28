import { z } from 'zod'

/** 已支持的 agent 来源 */
export const AgentSource = z.enum(['claude-code', 'codex', 'opencode', 'pi', 'manual', 'mcp'])
export type AgentSource = z.infer<typeof AgentSource>

export const AGENT_LABELS: Record<AgentSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  pi: 'pi',
  manual: '手动录入',
  mcp: 'MCP 写入',
}

export const ConversationRole = z.enum(['user', 'assistant', 'system', 'tool'])
export type ConversationRole = z.infer<typeof ConversationRole>

/**
 * 归一化后的消息。
 * 四个 agent 的落盘格式差异极大（Claude 的 JSONL、Codex 的 rollout、
 * pi 的 v3 JSONL、opencode 的 SQLite part 表），适配器负责把它们
 * 统统压平成这个结构，下游只认这一种形状。
 */
export const ConversationMessage = z.object({
  id: z.string(),
  role: ConversationRole,
  text: z.string(),
  timestamp: z.number().int(),
  /** 工具调用名，用于识别「执行了什么操作」类记忆 */
  toolName: z.string().optional(),
})
export type ConversationMessage = z.infer<typeof ConversationMessage>

export const Conversation = z.object({
  /** 全局唯一：`${agent}:${sessionId}` */
  id: z.string(),
  agent: AgentSource,
  sessionId: z.string(),
  title: z.string().default(''),
  cwd: z.string().optional(),
  project: z.string().optional(),
  branch: z.string().optional(),
  model: z.string().optional(),
  startedAt: z.number().int(),
  endedAt: z.number().int(),
  messages: z.array(ConversationMessage),
  /** 源文件路径或数据库标识，用于增量游标 */
  sourceRef: z.string(),
})
export type Conversation = z.infer<typeof Conversation>

/**
 * 增量摄取游标。
 * 每个源文件记一条：已读到的字节偏移 / 行号 / 最后修改时间。
 * 重启后从断点继续，不重复解析 GB 级的历史会话。
 */
export const IngestCursor = z.object({
  sourceRef: z.string(),
  agent: AgentSource,
  /** 文件型源：已消费的字节数；数据库型源：最后一条记录的时间戳 */
  offset: z.number().int().default(0),
  lastModified: z.number().int().default(0),
  lastMessageId: z.string().optional(),
  messageCount: z.number().int().default(0),
  updatedAt: z.number().int(),
})
export type IngestCursor = z.infer<typeof IngestCursor>
