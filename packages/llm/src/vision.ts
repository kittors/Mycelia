/**
 * 识图：把图片转成一段可检索的描述。
 *
 * 图片本身进不了向量空间 —— 嵌入模型吃的是文本。所以入库时先让视觉模型
 * 把图看成文字，描述参与向量化，图片就跟着可被搜到了：搜「架构图」
 * 能命中一张没有任何文字说明的白板照片。
 *
 * 只做这一件事，不做对话。所以不复用 LlmProvider 那套接口 ——
 * 它的抽象是「多轮消息」，而这里永远是「一张图 + 一句指令 → 一段文本」。
 */

import type { VisionConfig } from '@mycelia/shared'
import { createLogger } from '@mycelia/shared'

const log = createLogger('llm:vision')

const PROMPTS = {
  brief: '用一句话说明这张图画的是什么。直接给结论，不要「这张图片显示了」这类开场。',
  detailed: [
    '把这张图转述成文字，供全文检索使用。要求：',
    '1. 图里出现的所有文字原样保留（界面文案、图表标签、代码、手写字）',
    '2. 说清楚结构关系：谁指向谁、怎么分组、有几个层级',
    '3. 如果是图表，把关键数值和坐标轴含义写出来',
    '4. 直接开始描述，不要任何开场白',
  ].join('\n'),
} as const

export interface VisionProvider {
  readonly enabled: boolean
  /** 看图说话。失败返回空串 —— 识图只是增强，不该阻断入库 */
  describe(image: { base64: string; mime: string }, hint?: string): Promise<string>
}

class NoopVision implements VisionProvider {
  readonly enabled = false
  async describe(): Promise<string> {
    return ''
  }
}

/**
 * OpenAI 兼容的视觉接口。
 *
 * 各家（OpenAI、Anthropic 经 OpenAI 兼容层、各种中转、Ollama 的
 * llava/qwen-vl）都支持这个 image_url + base64 的格式，是覆盖面最广的一种。
 */
class OpenAIVision implements VisionProvider {
  readonly enabled = true
  constructor(
    private readonly config: VisionConfig,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async describe(image: { base64: string; mime: string }, hint?: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const instruction = hint
        ? `${PROMPTS[this.config.detail]}\n\n补充背景：${hint}`
        : PROMPTS[this.config.detail]

      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.detail === 'detailed' ? 1200 : 200,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                {
                  type: 'image_url',
                  image_url: { url: `data:${image.mime};base64,${image.base64}` },
                },
              ],
            },
          ],
        }),
      })

      if (!response.ok) {
        log.warn(`识图失败 ${response.status}：${(await response.text()).slice(0, 200)}`)
        return ''
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return data.choices?.[0]?.message?.content?.trim() ?? ''
    } catch (error) {
      // 超时、断网、模型不支持视觉 —— 都不该让图片入不了库
      log.warn(`识图异常：${error instanceof Error ? error.message : String(error)}`)
      return ''
    } finally {
      clearTimeout(timer)
    }
  }
}

export function createVision(
  config: VisionConfig,
  fallback: { baseUrl: string; apiKey?: string },
): VisionProvider {
  if (!config.enabled) return new NoopVision()

  // 没单独配就复用主模型的端点 —— 多数供应商的视觉模型走同一个入口
  const baseUrl = config.baseUrl || fallback.baseUrl
  const apiKey = process.env[config.apiKeyEnv] || config.apiKey || fallback.apiKey || ''

  if (!baseUrl) {
    log.warn('识图已启用但没有可用端点，已降级为不识图')
    return new NoopVision()
  }
  return new OpenAIVision(config, apiKey, baseUrl)
}
