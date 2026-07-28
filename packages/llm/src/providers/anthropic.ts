import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from '../types.js'
import { type BaseOptions, request, testProvider } from './http.js'

/** Anthropic Messages API */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic'
  readonly model: string
  readonly enabled = true
  private readonly opts: BaseOptions

  constructor(opts: Partial<BaseOptions> & { model: string }) {
    this.opts = {
      baseUrl: (opts.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, ''),
      apiKey: opts.apiKey,
      model: opts.model,
      maxTokens: opts.maxTokens ?? 4096,
      timeoutMs: opts.timeoutMs ?? 120_000,
    }
    this.model = opts.model
  }

  async chat(messages: readonly ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    // Anthropic 的 system 是顶层参数，不在 messages 数组里
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const rest = messages.filter((m) => m.role !== 'system')
    const model = opts.model ?? this.opts.model

    const res = await request(
      `${this.opts.baseUrl}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? this.opts.maxTokens,
          temperature: opts.temperature ?? 0.2,
          ...(system ? { system } : {}),
          messages: rest.map((m) => ({ role: m.role, content: m.content })),
        }),
      },
      opts.timeoutMs ?? this.opts.timeoutMs!,
      opts.signal,
    )

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>
      usage?: { input_tokens: number; output_tokens: number }
    }
    const text = (json.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')

    return {
      text,
      model,
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    }
  }

  test(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    return testProvider(this)
  }
}
