import { z } from 'zod'
import { defaultAgentPaths } from './paths.js'

/**
 * 默认文本模型端点。
 *
 * 指向 OpenAI 官方，因为它的协议被最广泛地兼容 —— 各家中转、本地推理
 * （Ollama、LM Studio、vLLM）几乎都提供 OpenAI 格式的入口，
 * 换端点只需要改 baseUrl，不必动别的。
 *
 * 项目里不内置任何可用的凭据：一份公开仓库里的 key 几小时内就会被刷爆，
 * 而且那笔账单记在提交它的人头上。用 MYCELIA_LLM_API_KEY 环境变量
 * 或应用的设置页配置自己的。
 */
export const DEFAULT_LLM_BASE_URL =
  process.env.MYCELIA_LLM_BASE_URL ?? 'https://api.openai.com/v1'
export const DEFAULT_LLM_MODEL = process.env.MYCELIA_LLM_MODEL ?? 'gpt-4o-mini'

/**
 * 接入协议。同一个模型经常同时提供多种协议入口，选错只会 404，
 * 所以这里让用户显式指定，而不是靠 baseUrl 猜。
 *
 * - anthropic         Anthropic Messages API（/v1/messages）
 * - openai            OpenAI Chat Completions（/v1/chat/completions），兼容绝大多数中转
 * - openai-responses  OpenAI Responses API（/v1/responses），新版有状态接口
 * - ollama            本机 Ollama 原生协议（/api/chat）
 * - none              不用模型，全部走规则降级
 */
export const LlmProtocol = z.enum(['anthropic', 'openai', 'openai-responses', 'ollama', 'none'])
export type LlmProtocol = z.infer<typeof LlmProtocol>

export const LlmProviderConfig = z.object({
  provider: LlmProtocol.default('openai'),
  baseUrl: z.string().default(DEFAULT_LLM_BASE_URL),
  apiKey: z.string().optional(),
  model: z.string().default(DEFAULT_LLM_MODEL),
  /** 单次提取的最大输出 token */
  maxTokens: z.number().int().default(4096),
  /** 环境变量名，优先级高于明文 apiKey —— 避免密钥落进 config.json */
  apiKeyEnv: z.string().default('MYCELIA_LLM_API_KEY'),
  /**
   * 高频轻量任务（给文档块生成定位摘要）专用的小模型，留空则复用主模型。
   * 索引一个几百页的目录会产生上千次这类调用，用小模型能省一个数量级的成本。
   */
  fastModel: z.string().optional(),
  /** 请求超时。本地模型首次加载慢，需要比云端给得宽松 */
  timeoutMs: z.number().int().default(120_000),
})
export type LlmProviderConfig = z.infer<typeof LlmProviderConfig>

export const EmbeddingConfig = z.object({
  /**
   * local  = 内置 ONNX 模型（默认）。随应用分发，离线可用，语义质量是检索的下限保障。
   * openai = 任意 OpenAI 兼容的 /v1/embeddings
   * ollama = 本机 Ollama
   * hash   = 零依赖兜底向量。只在本地模型加载失败时自动降级，不建议主动选。
   */
  provider: z.enum(['local', 'openai', 'ollama', 'hash']).default('local'),
  model: z.string().default('Xenova/multilingual-e5-small'),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  dimensions: z.number().int().default(384),
  batchSize: z.number().int().default(16),
  /**
   * 推理并发数。onnxruntime 单条推理已吃满多核，并发过高只会互相抢 CPU，
   * 反而拖慢整体吞吐 —— 2 是实测下来的平衡点。
   */
  concurrency: z.number().int().min(1).max(8).default(2),
})
export type EmbeddingConfig = z.infer<typeof EmbeddingConfig>

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
export const KnowledgeSource = z.object({
  id: z.string(),
  name: z.string(),
  /** 目录绝对路径 */
  path: z.string(),
  enabled: z.boolean().default(true),
  /** 监听文件变更并增量重建索引 */
  watch: z.boolean().default(true),
  /** 纳入索引的扩展名，不含点 */
  extensions: z.array(z.string()).default(['md', 'mdx', 'txt', 'rst', 'org']),
  /** 相对于根目录的排除片段 */
  exclude: z.array(z.string()).default(['node_modules', '.git', '.obsidian', 'dist', 'build']),
})
export type KnowledgeSource = z.infer<typeof KnowledgeSource>

export const KnowledgeConfig = z.object({
  sources: z.array(KnowledgeSource).default([]),
  /**
   * 分块目标长度（字符）。900 左右能装下一个完整小节，
   * 又不至于让单块里塞进太多不相关内容导致向量被稀释。
   */
  chunkSize: z.number().int().default(900),
  /** 相邻块的重叠字符数，避免答案正好被切在边界上 */
  chunkOverlap: z.number().int().default(150),
  /** 超过此大小的文件跳过，避免把日志、导出数据啃进来 */
  maxFileSizeKb: z.number().int().default(512),
  /** 文档检索在混合召回里的权重 */
  weight: z.number().min(0).max(1).default(0.5),
})
export type KnowledgeConfig = z.infer<typeof KnowledgeConfig>

export const GraphConfig = z.object({
  /** 每个节点最多连多少条语义边 —— 控制图的稠密度，太密就看不清簇了 */
  semanticNeighbors: z.number().int().default(6),
  /** 语义边的相似度下限 */
  semanticThreshold: z.number().min(0).max(1).default(0.62),
  /** Louvain 分辨率，越大簇越碎 */
  clusterResolution: z.number().default(1.0),
  /** 是否把实体也画成节点（关掉后只剩记忆节点，图会更稀疏） */
  includeEntities: z.boolean().default(true),
})
export type GraphConfig = z.infer<typeof GraphConfig>

export const RetrievalConfig = z.object({
  /** 混合检索里向量与全文的权重配比 */
  vectorWeight: z.number().min(0).max(1).default(0.6),
  keywordWeight: z.number().min(0).max(1).default(0.4),
  /** 检索结果沿图谱扩散一跳，把强关联记忆一起带出来 */
  graphExpansion: z.boolean().default(true),
  defaultLimit: z.number().int().default(8),
  /** MCP 侧默认是否允许返回 secret 记忆（默认否，安全第一） */
  exposeSecrets: z.boolean().default(false),
})
export type RetrievalConfig = z.infer<typeof RetrievalConfig>

export const Config = z.object({
  version: z.literal(1).default(1),
  llm: LlmProviderConfig.default({}),
  embedding: EmbeddingConfig.default({}),
  ingest: IngestConfig.default({}),
  extraction: ExtractionConfig.default({}),
  capture: CaptureConfig.default({}),
  knowledge: KnowledgeConfig.default({}),
  graph: GraphConfig.default({}),
  retrieval: RetrievalConfig.default({}),
  /** daemon 本地 HTTP 端口，0 表示随机端口写入 runtime.json */
  daemonPort: z.number().int().default(0),
  locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  /** 界面主题，system 跟随操作系统 */
  theme: z.enum(['system', 'dark', 'light']).default('system'),
})
export type Config = z.infer<typeof Config>

/**
 * 文本模型凭据只从环境变量取，代码里不留任何默认值。
 *
 * 没配也能用：LLM 只影响长文入库时的上下文增强与去重判定这类锦上添花的环节，
 * 记忆的读写、检索、图谱都不依赖它。
 */
const BUNDLED_LLM_API_KEY = process.env.MYCELIA_LLM_API_KEY ?? ''

export function defaultConfig(): Config {
  const paths = defaultAgentPaths()
  return Config.parse({
    llm: {
      provider: 'openai',
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: DEFAULT_LLM_MODEL,
      apiKey: BUNDLED_LLM_API_KEY,
    },
    ingest: {
      sources: {
        'claude-code': { enabled: true, path: paths['claude-code'] },
        codex: { enabled: true, path: paths.codex },
        opencode: { enabled: true, path: paths.opencode },
        pi: { enabled: true, path: paths.pi },
      },
    },
  })
}

/**
 * 解析 API Key：优先环境变量，其次配置文件明文。
 * 这样默认路径下密钥不会被写进 config.json，也就不会被误提交。
 */
export function resolveApiKey(cfg: { apiKey?: string; apiKeyEnv?: string }): string | undefined {
  if (cfg.apiKeyEnv) {
    const v = process.env[cfg.apiKeyEnv]
    if (v) return v
  }
  return cfg.apiKey
}
