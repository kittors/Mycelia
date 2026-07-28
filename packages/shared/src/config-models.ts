/**
 * 模型相关的配置：识图与嵌入。
 *
 * 从主配置里分出来 —— 它们各自有一堆说明性注释，混在一起读起来
 * 找不到边界。主配置只负责把它们组装成一棵树。
 */

import { z } from 'zod'

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

/**
 * 识图模型。
 *
 * 图片本身无法被向量检索 —— 嵌入模型吃的是文本。所以入库时先让视觉模型
 * 把图看成一段描述，描述参与向量化，图片就跟着可被搜到了：
 * 搜「架构图」能命中一张没有任何文字说明的白板照片。
 *
 * 不配也不影响用：图片照样存、照样显示，只是检索不到内容。
 */
export const VisionConfig = z.object({
  enabled: z.boolean().default(false),
  /** 留空则复用主 LLM 的协议与端点 —— 多数供应商的视觉模型走同一个入口 */
  provider: LlmProtocol.optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().default('MYCELIA_VISION_API_KEY'),
  model: z.string().default('gpt-4o-mini'),
  /**
   * 描述的详细程度。
   *
   * brief 适合插图（一句话说明画的是什么），detailed 适合图表和截图
   * （连坐标轴、图例、界面里的文字一起转述）—— 后者贵得多，
   * 但对「把截图丢进知识库还能搜到」这个场景是必需的。
   */
  detail: z.enum(['brief', 'detailed']).default('detailed'),
  timeoutMs: z.number().int().default(90_000),
})
export type VisionConfig = z.infer<typeof VisionConfig>

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
