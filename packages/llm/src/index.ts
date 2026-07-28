import type { LlmProviderConfig } from '@mycelia/shared'
import { resolveApiKey } from '@mycelia/shared'
import { guardEgress } from './guard.js'
import {
  AnthropicProvider,
  NoopProvider,
  OllamaProvider,
  OpenAIProvider,
  OpenAIResponsesProvider,
} from './providers/index.js'
import type { ChatOptions, LlmProvider } from './types.js'

/**
 * 建一个模型客户端。
 *
 * 一律裹上 guardEgress —— 出口只有这一个，凭据脱敏就放在这里，
 * 调用方不需要知道有这回事，也就没法忘记。
 */
export function createLlm(config: LlmProviderConfig): LlmProvider {
  return guardEgress(createRaw(config))
}

function createRaw(config: LlmProviderConfig): LlmProvider {
  const apiKey = resolveApiKey(config)
  const shared = {
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  }

  switch (config.provider) {
    case 'anthropic':
      // 没有 key 就别装作能用，直接返回 Noop 让上层走规则模式
      if (!apiKey) return new NoopProvider()
      return new AnthropicProvider(shared)
    case 'openai':
      if (!apiKey && !config.baseUrl) return new NoopProvider()
      return new OpenAIProvider(shared)
    case 'openai-responses':
      if (!apiKey && !config.baseUrl) return new NoopProvider()
      return new OpenAIResponsesProvider(shared)
    case 'ollama':
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        timeoutMs: config.timeoutMs,
      })
    default:
      return new NoopProvider()
  }
}

/**
 * 轻量任务的调用选项。
 *
 * 文档索引会为每个块生成一句定位摘要 —— 一个中等规模的笔记目录就是上千次调用。
 * 配了 fastModel 就走小模型，没配则复用主模型，调用方不必关心差异。
 */
export function fastOptions(config: LlmProviderConfig, opts: ChatOptions = {}): ChatOptions {
  return { ...opts, model: opts.model ?? config.fastModel ?? config.model }
}

export { guardEgress } from './guard.js'
export * from './types.js'
export { createVision, type VisionProvider } from './vision.js'
export { AnthropicProvider, NoopProvider, OllamaProvider, OpenAIProvider, OpenAIResponsesProvider }
