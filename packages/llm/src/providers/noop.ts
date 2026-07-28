import { ProviderError } from '@mycelia/shared'
import type { ChatResult, LlmProvider } from '../types.js'

/**
 * 空实现。
 * 用户没配 LLM 时用它 —— 上层据 enabled=false 走规则提取，
 * 而不是让整个功能报错。「没有 API Key 也能用」是这个产品的底线之一。
 */
export class NoopProvider implements LlmProvider {
  readonly id = 'none'
  readonly model = 'none'
  readonly enabled = false

  async chat(): Promise<ChatResult> {
    throw new ProviderError('none', '未配置 LLM，无法调用')
  }

  async test() {
    return { ok: false, message: '未配置 LLM。记忆提取将使用规则模式（质量较低但完全离线）' }
  }
}
