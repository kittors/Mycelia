/**
 * 支持的接口协议。
 *
 * 同一个模型经常同时提供多种协议入口，选错只会 404 ——
 * 所以让用户显式指定，并把实际请求路径显示出来，方便对照服务商文档。
 */

export const PROTOCOLS = [
  { value: 'openai', label: 'OpenAI Chat Completions', path: '/chat/completions' },
  { value: 'openai-responses', label: 'OpenAI Responses', path: '/responses' },
  { value: 'anthropic', label: 'Anthropic Messages', path: '/messages' },
  { value: 'ollama', label: 'Ollama 原生', path: '/api/chat' },
  { value: 'none', label: '不使用模型（规则降级）', path: '' },
] as const
