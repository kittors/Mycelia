import { ProviderError } from '@mycelia/shared'
import { BaseEmbedder, prepareText } from './types.js'

export interface RemoteEmbedderOptions {
  baseUrl: string
  apiKey?: string
  model: string
  dimensions: number
  batchSize?: number
  timeoutMs?: number
}

/**
 * OpenAI 兼容的嵌入接口（/v1/embeddings）。
 * 绝大多数中转与自建服务都实现了这套协议，包括 Voyage、Jina、各家 relay。
 */
export class OpenAIEmbedder extends BaseEmbedder {
  readonly kind = 'remote' as const
  readonly id: string
  readonly dimensions: number
  private readonly opts: Required<Omit<RemoteEmbedderOptions, 'apiKey'>> & { apiKey?: string }

  constructor(opts: RemoteEmbedderOptions) {
    super()
    this.id = `openai:${opts.model}`
    this.dimensions = opts.dimensions
    this.opts = {
      baseUrl: opts.baseUrl.replace(/\/$/, ''),
      apiKey: opts.apiKey,
      model: opts.model,
      dimensions: opts.dimensions,
      batchSize: opts.batchSize ?? 16,
      timeoutMs: opts.timeoutMs ?? 30_000,
    }
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = []
    // 分批：单次请求塞太多文本会超时或触发长度限制
    for (let i = 0; i < texts.length; i += this.opts.batchSize) {
      const batch = texts.slice(i, i + this.opts.batchSize).map((t) => prepareText(t, 6000))
      out.push(...(await this.embedBatch(batch)))
    }
    return out
  }

  private async embedBatch(input: string[]): Promise<Float32Array[]> {
    const res = await fetchWithTimeout(
      `${this.opts.baseUrl}/embeddings`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.opts.model, input }),
      },
      this.opts.timeoutMs,
    )

    if (!res.ok) {
      throw new ProviderError('embedding', `HTTP ${res.status}：${await safeText(res)}`)
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> }
    if (!json.data?.length) throw new ProviderError('embedding', '响应里没有 data 字段')
    return json.data.map((d) => Float32Array.from(d.embedding))
  }
}

/** Ollama 的本地嵌入接口（/api/embed），常配 bge-m3 / nomic-embed-text */
export class OllamaEmbedder extends BaseEmbedder {
  readonly kind = 'local' as const
  readonly id: string
  readonly dimensions: number
  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(opts: { baseUrl?: string; model: string; dimensions: number; timeoutMs?: number }) {
    super()
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
    this.model = opts.model
    this.dimensions = opts.dimensions
    this.id = `ollama:${opts.model}`
    this.timeoutMs = opts.timeoutMs ?? 60_000
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/embed`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts.map((t) => prepareText(t, 6000)) }),
      },
      this.timeoutMs,
    )
    if (!res.ok) {
      throw new ProviderError('ollama', `HTTP ${res.status}：${await safeText(res)}`)
    }
    const json = (await res.json()) as { embeddings?: number[][] }
    if (!json.embeddings?.length) throw new ProviderError('ollama', '响应里没有 embeddings')
    return json.embeddings.map((e) => Float32Array.from(e))
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (controller.signal.aborted) {
      throw new ProviderError('http', `请求超时（${timeoutMs}ms）：${url}`)
    }
    throw new ProviderError('http', `请求失败：${url}`, e)
  } finally {
    clearTimeout(timer)
  }
}

export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return '(无响应体)'
  }
}
