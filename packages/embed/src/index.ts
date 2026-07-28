import type { EmbeddingConfig } from '@mycelia/shared'
import { createLogger, resolveApiKey } from '@mycelia/shared'
import { HashEmbedder } from './hash.js'
import { LocalEmbedder } from './local.js'
import { OllamaEmbedder, OpenAIEmbedder } from './remote.js'
import type { Embedder } from './types.js'

const log = createLogger('embed')

/**
 * 按配置创建嵌入器。
 *
 * 失败时不抛错，而是降级到内置哈希嵌入 —— 检索质量下降好过整个系统不可用。
 * 降级会打 warn 日志，桌面端设置页也会显示当前实际生效的 provider。
 */
export function createEmbedder(config: EmbeddingConfig): Embedder {
  try {
    switch (config.provider) {
      case 'local':
        return new LocalEmbedder(config.model, config.dimensions)
      case 'openai': {
        const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
        return new OpenAIEmbedder({
          baseUrl,
          apiKey: resolveApiKey(config),
          model: config.model,
          dimensions: config.dimensions,
          batchSize: config.batchSize,
        })
      }
      case 'ollama':
        return new OllamaEmbedder({
          baseUrl: config.baseUrl,
          model: config.model,
          dimensions: config.dimensions,
        })
      default:
        return new HashEmbedder(config.dimensions)
    }
  } catch (e) {
    log.warn(`嵌入器创建失败，降级为内置哈希嵌入：${String(e)}`)
    return new HashEmbedder(config.dimensions)
  }
}

/**
 * 带降级的嵌入器包装。
 * 远程 API 抽风时（限流、断网），单条失败不该让整个提取流水线崩掉。
 */
export function withFallback(primary: Embedder, fallback: Embedder = new HashEmbedder()): Embedder {
  return {
    id: primary.id,
    dimensions: primary.dimensions,
    kind: primary.kind,
    async embed(texts) {
      try {
        return await primary.embed(texts)
      } catch (e) {
        log.warn(`${primary.id} 嵌入失败，本批降级：${String(e)}`)
        return fallback.embed(texts)
      }
    },
    async embedOne(text) {
      try {
        return await primary.embedOne(text)
      } catch {
        return fallback.embedOne(text)
      }
    },
    dispose: () => primary.dispose?.() ?? Promise.resolve(),
  }
}

export * from './types.js'
export { HashEmbedder, LocalEmbedder, OllamaEmbedder, OpenAIEmbedder }
