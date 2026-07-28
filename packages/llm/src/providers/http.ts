/**
 * provider 共用的 HTTP 层。
 *
 * 四家协议的差异在请求体和响应解析，超时、中断、错误包装是一样的，
 * 所以收在这里 —— 也保证了错误消息格式一致，用户看到的提示不会因协议而异。
 */

import { ProviderError } from '@mycelia/shared'
import type { LlmProvider } from '../types.js'

/** 各 provider 的公共构造参数 */
export interface BaseOptions {
  baseUrl: string
  apiKey?: string
  model: string
  maxTokens: number
  timeoutMs?: number
}

/** 带超时与外部中断的请求。失败一律包成 ProviderError，上层只需处理一种错误 */
export async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onAbort)

  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError('llm', `HTTP ${res.status} ${url}：${body.slice(0, 300)}`)
    }
    return res
  } catch (e) {
    if (e instanceof ProviderError) throw e
    if (controller.signal.aborted) throw new ProviderError('llm', `请求超时（${timeoutMs}ms）`)
    throw new ProviderError('llm', `请求失败：${String(e)}`)
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

/** 连通性自检，供 doctor 与设置页的「测试连接」共用 */
export async function testProvider(p: LlmProvider) {
  const t0 = Date.now()
  try {
    const res = await p.chat([{ role: 'user', content: '回复两个字：就绪' }], {
      maxTokens: 32,
      timeoutMs: 30_000,
    })
    const latencyMs = Date.now() - t0
    return {
      ok: true,
      message: `连接正常，模型 ${res.model} 回复「${res.text.trim().slice(0, 20)}」`,
      latencyMs,
    }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}
