import { redact } from '@mycelia/crypto'
import { createLogger } from '@mycelia/shared'
import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from './types.js'

const log = createLogger('llm:guard')

/**
 * 出网前的最后一道闸。
 *
 * 知识库里存的是原文 —— 跟磁盘上那份笔记一模一样，本来就该如此：本机的
 * 文件读本机的库，多一道加密只是自欺。真正的边界在这里：一旦内容要离开
 * 这台机器，凭据就不能跟着走。
 *
 * 包在 provider 而不是各个调用点上，是因为调用点会长出新的 —— 文档摘要、
 * 块定位、记忆抽取、冲突判定，往后还会有更多。每处各写一遍脱敏，迟早漏掉
 * 一处；而漏掉的那次不会报错，只会安静地把密码发出去。包在唯一的出口上，
 * 就没有「忘了加」的可能。
 *
 * 本地模型（ollama）也照样脱敏：模型不外传不等于不落盘，推理服务的日志
 * 一样是明文。何况「本地」这个前提哪天变了，没人会回来改这里。
 */
export function guardEgress(inner: LlmProvider): LlmProvider {
  return {
    get id() {
      return inner.id
    },
    get model() {
      return inner.model
    },
    get enabled() {
      return inner.enabled
    },
    test: () => inner.test(),
    chat(messages: readonly ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
      let hits = 0
      const clean = messages.map((message) => {
        const { text, matches } = redact(message.content)
        if (matches.length === 0) return message
        hits += matches.length
        return { ...message, content: text }
      })
      if (hits > 0) log.info('已从出网内容中抹去凭据', { count: hits })
      return inner.chat(clean, opts)
    },
  }
}
