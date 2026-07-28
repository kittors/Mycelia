import { z } from 'zod'

/**
 * 记忆类型。分类不是为了好看 —— 它决定了三件事：
 *   1. 提取时用哪套 prompt 规则
 *   2. 检索时的默认权重（credential 永远精确匹配优先，insight 偏语义）
 *   3. 图谱里的节点配色与聚簇倾向
 */
export const MemoryKind = z.enum([
  /** 稳定事实：某服务跑在哪个端口、某个库的版本约束 */
  'fact',
  /** 用户偏好与工作习惯：「必须用中文回复」「提交信息用 conventional commits」 */
  'preference',
  /** 技术决策及其理由：为什么选 A 不选 B */
  'decision',
  /** 可复现的操作步骤 / 命令序列 */
  'howto',
  /** 凭据与访问方式：SSH、API Key、数据库连接串。强制 secret 敏感度 */
  'credential',
  /** 项目进展：这周干了什么、当前阻塞在哪 */
  'project',
  /** 学习记录：新掌握的概念、踩过的坑 */
  'learning',
  /** 排障结论：问题现象 → 根因 → 解法 */
  'issue',
  /** 跨会话提炼出的洞察 / 总结 */
  'insight',
  /** 实体档案：人、仓库、服务器、服务、技术栈 */
  'entity',
])
export type MemoryKind = z.infer<typeof MemoryKind>

/**
 * 敏感度分级 —— 这是安全边界，不是标签。
 * - public:  可以自由返回给任何 agent
 * - private: 返回给 agent，但不参与云端同步、不出现在分享导出里
 * - secret:  内容 AES-256-GCM 加密落盘；检索默认只返回标题与占位符，
 *            必须显式解锁（unlock）才能拿到明文。SSH 密钥、token 走这一档。
 */
export const Sensitivity = z.enum(['public', 'private', 'secret'])
export type Sensitivity = z.infer<typeof Sensitivity>

export const MemoryStatus = z.enum([
  /** 正常生效 */
  'active',
  /** 用户归档，不参与检索但保留在图谱里 */
  'archived',
  /** 被更新的记忆取代（由 supersedes 边指向新版本） */
  'superseded',
  /** 等待用户确认的候选记忆（自动提取的低置信度产物） */
  'pending',
])
export type MemoryStatus = z.infer<typeof MemoryStatus>

/**
 * 记忆是怎么进来的 —— 决定它在审核队列里的默认可信度。
 *
 * - agent   agent 在对话中通过 MCP 主动写入。这是主路径。
 * - manual  用户在桌面端手写，最高可信度，不走准入把关。
 * - import  从历史会话日志一次性回捞。存量补齐，默认需要人工确认。
 * - rule    无模型时的规则提取产物，质量最低。
 */
export const CaptureMode = z.enum(['agent', 'manual', 'import', 'rule'])
export type CaptureMode = z.infer<typeof CaptureMode>

/** 记忆的来源出处 —— 保留可追溯性，用户永远能问「这条记忆哪来的」 */
export const MemoryOrigin = z.object({
  /** 产出这条记忆的 agent：claude-code / codex / opencode / pi / manual / mcp */
  agent: z.string(),
  /** agent 侧的会话 ID */
  sessionId: z.string().optional(),
  /**
   * 这条记忆是从哪篇文档提炼出来的。
   *
   * 有了它，记忆才不是无根的断言 —— 点开能回到原文核对，文档更新时也知道
   * 哪些记忆需要重新审视。图谱里那条「派生自」的边也是靠它连起来的。
   */
  documentId: z.string().optional(),
  /** 会话发生时的工作目录 */
  cwd: z.string().optional(),
  /** 归属项目（通常是 cwd 的 git 仓库名） */
  project: z.string().optional(),
  /** git 分支 */
  branch: z.string().optional(),
  /** 贡献了这条记忆的原始消息 ID，用于回溯原文 */
  messageIds: z.array(z.string()).default([]),
  /** 原始片段的截取，方便在 UI 里展示上下文 */
  excerpt: z.string().optional(),
})
export type MemoryOrigin = z.infer<typeof MemoryOrigin>

export const Memory = z.object({
  id: z.string(),
  kind: MemoryKind,
  /** 一句话标题，图谱节点上显示的就是它 */
  title: z.string().min(1),
  /** 记忆正文。secret 记忆在库里是密文，读出来时按权限决定是否解密 */
  content: z.string(),
  /** 用于向量化和列表预览的浓缩摘要 */
  summary: z.string().default(''),

  tags: z.array(z.string()).default([]),
  sensitivity: Sensitivity.default('public'),
  status: MemoryStatus.default('active'),

  /** 提取置信度 0~1，低于阈值的进 pending 等用户确认 */
  confidence: z.number().min(0).max(1).default(0.8),
  /** 重要度 0~1，影响检索排序与图谱节点大小；用户可手动置顶 */
  importance: z.number().min(0).max(1).default(0.5),
  /** 用户手动固定的记忆永不被自动衰减或清理 */
  pinned: z.boolean().default(false),

  origin: MemoryOrigin,
  captureMode: CaptureMode.default('manual'),

  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastAccessedAt: z.number().int().optional(),
  accessCount: z.number().int().default(0),
  /** 被检索命中的次数 —— 「哪些记忆真正在被用」的依据，与 accessCount 含义不同 */
  recallCount: z.number().int().default(0),
  lastRecalledAt: z.number().int().optional(),
  /** 有效期截止时间，用于「这周干了啥」这类时效性记忆 */
  expiresAt: z.number().int().optional(),

  /** 内容哈希，用于去重 */
  contentHash: z.string(),
  /** 向量模型标识，换模型后需要重新嵌入 */
  embeddingModel: z.string().optional(),
})
export type Memory = z.infer<typeof Memory>

/** 新建记忆时的入参：ID / 时间戳 / 哈希由 store 负责生成 */
export const MemoryInput = Memory.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  contentHash: true,
  accessCount: true,
  recallCount: true,
  lastRecalledAt: true,
}).partial({
  summary: true,
  tags: true,
  sensitivity: true,
  status: true,
  confidence: true,
  importance: true,
  pinned: true,
  captureMode: true,
})
export type MemoryInput = z.infer<typeof MemoryInput>

export const MemoryPatch = Memory.pick({
  kind: true,
  title: true,
  content: true,
  summary: true,
  tags: true,
  sensitivity: true,
  status: true,
  confidence: true,
  importance: true,
  pinned: true,
  expiresAt: true,
}).partial()
export type MemoryPatch = z.infer<typeof MemoryPatch>

/** secret 记忆在未解锁时对外呈现的占位内容 */
export const SECRET_PLACEHOLDER = '[[mycelia:locked]] 该记忆已加密，需在桌面端或 CLI 显式解锁后读取'

/** credential 类记忆强制 secret —— 防止提取器把密钥标成 public */
export function enforceSensitivity(kind: MemoryKind, requested: Sensitivity): Sensitivity {
  if (kind === 'credential') return 'secret'
  return requested
}
