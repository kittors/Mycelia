/**
 * 文本模型接入。
 *
 * 每种协议一个文件 —— 它们的差异不只是路径：
 * Anthropic 的 system 是顶层参数，Responses 的 messages 叫 input、
 * max_tokens 叫 max_output_tokens、返回结构也从 choices 换成 output 数组。
 * 用参数开关硬套只会让某一家出问题时四家一起遭殃。
 */

export { AnthropicProvider } from './anthropic.js'
export type { BaseOptions } from './http.js'
export { NoopProvider } from './noop.js'
export { OllamaProvider } from './ollama.js'
export { OpenAIProvider } from './openai-chat.js'
export { OpenAIResponsesProvider } from './openai-responses.js'
