import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from '../types.js'
import { request, testProvider } from './http.js'

/** Ollama 本地模型 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama'
  readonly model: string
  readonly enabled = true
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(opts: { baseUrl?: string; model: string; timeoutMs?: number }) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
    this.model = opts.model
    // 本地模型首次加载慢，超时给足
    this.timeoutMs = opts.timeoutMs ?? 300_000
  }

  async chat(messages: readonly ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const model = opts.model ?? this.model
    const res = await request(
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          ...(opts.json ? { format: 'json' } : {}),
          options: { temperature: opts.temperature ?? 0.2 },
        }),
      },
      opts.timeoutMs ?? this.timeoutMs,
      opts.signal,
    )

    const json = (await res.json()) as {
      message?: { content?: string }
      prompt_eval_count?: number
      eval_count?: number
    }
    return {
      text: json.message?.content ?? '',
      model,
      inputTokens: json.prompt_eval_count,
      outputTokens: json.eval_count,
    }
  }

  test(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    return testProvider(this)
  }
}
