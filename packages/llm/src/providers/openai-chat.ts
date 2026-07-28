import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from '../types.js'
import { type BaseOptions, request, testProvider } from './http.js'

/** OpenAI Chat Completions（含各类中转、DeepSeek、Kimi、本地 vLLM 等） */
export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai'
  readonly model: string
  readonly enabled = true
  private readonly opts: BaseOptions

  constructor(opts: Partial<BaseOptions> & { model: string }) {
    this.opts = {
      baseUrl: (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: opts.apiKey,
      model: opts.model,
      maxTokens: opts.maxTokens ?? 4096,
      timeoutMs: opts.timeoutMs ?? 120_000,
    }
    this.model = opts.model
  }

  async chat(messages: readonly ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const model = opts.model ?? this.opts.model
    const res = await request(
      `${this.opts.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? this.opts.maxTokens,
          temperature: opts.temperature ?? 0.2,
          messages,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      },
      opts.timeoutMs ?? this.opts.timeoutMs!,
      opts.signal,
    )

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens: number; completion_tokens: number }
    }
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      model,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    }
  }

  test(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    return testProvider(this)
  }
}
