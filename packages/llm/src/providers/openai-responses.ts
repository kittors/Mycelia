import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from '../types.js'
import { type BaseOptions, request, testProvider } from './http.js'

/**
 * OpenAI Responses API（/v1/responses）。
 *
 * 与 Chat Completions 的差异不只是路径：system 变成顶层 instructions，
 * messages 变成 input，max_tokens 变成 max_output_tokens，
 * 返回结构也从 choices 换成 output 数组。所以它必须是独立实现而不是参数开关。
 */
export class OpenAIResponsesProvider implements LlmProvider {
  readonly id = 'openai-responses'
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
    const instructions = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const input = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
      }))

    const model = opts.model ?? this.opts.model
    const res = await request(
      `${this.opts.baseUrl}/responses`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          input,
          ...(instructions ? { instructions } : {}),
          max_output_tokens: opts.maxTokens ?? this.opts.maxTokens,
          temperature: opts.temperature ?? 0.2,
          ...(opts.json ? { text: { format: { type: 'json_object' } } } : {}),
        }),
      },
      opts.timeoutMs ?? this.opts.timeoutMs!,
      opts.signal,
    )

    const json = (await res.json()) as {
      output_text?: string
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }

    // output_text 是便捷字段，中转实现未必提供，所以保留遍历 output 的兜底路径
    const text =
      json.output_text ??
      (json.output ?? [])
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text' || part.type === 'text')
        .map((part) => part.text ?? '')
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
