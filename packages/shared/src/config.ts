import { z } from 'zod'
import { CaptureConfig, ExtractionConfig, IngestConfig } from './config-capture.js'
import { EmbeddingConfig, LlmProtocol, VisionConfig } from './config-models.js'
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
export const DEFAULT_LLM_BASE_URL = process.env.MYCELIA_LLM_BASE_URL ?? 'https://api.openai.com/v1'
export const DEFAULT_LLM_MODEL = process.env.MYCELIA_LLM_MODEL ?? 'gpt-4o-mini'

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
  /**
   * 把目录里的图片也索引进来。
   *
   * 默认关：图片索引依赖识图模型，每张图一次 API 调用 —— 挂载一个装着
   * 几千张截图的目录，费用和耗时都不是小数。想要的人自己开。
   *
   * 开启但没配识图模型时只登记文件名，检索能按文件名找到，但看不见内容。
   */
  indexImages: z.boolean().default(false),
  /** 单张图上限。超大图对识图质量没有增益，只会更慢更贵 */
  maxImageSizeKb: z.number().int().default(8192),
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
  vision: VisionConfig.default({}),
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
export { CaptureConfig, ExtractionConfig, IngestConfig } from './config-capture.js'
export { EmbeddingConfig, LlmProtocol, VisionConfig } from './config-models.js'

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
