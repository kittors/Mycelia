import { detectSecrets, redact } from '@mycelia/crypto'
import { extractJson, type LlmProvider } from '@mycelia/llm'
import type {
  Conversation,
  EntityKind,
  ExtractionConfig,
  MemoryKind,
  Sensitivity,
} from '@mycelia/shared'
import { clamp, createLogger, normalizeTag, truncate } from '@mycelia/shared'
import { buildExtractionPrompt } from './prompt.js'
import { extractByRules } from './rules.js'
import type { ExtractedMemory, ExtractionOutcome } from './types.js'

const log = createLogger('core:extract')

const VALID_KINDS = new Set<MemoryKind>([
  'fact',
  'preference',
  'decision',
  'howto',
  'credential',
  'project',
  'learning',
  'issue',
  'insight',
  'entity',
])

const VALID_ENTITY_KINDS = new Set<EntityKind>([
  'person',
  'repo',
  'service',
  'host',
  'tech',
  'file',
  'org',
  'concept',
])

/** LLM 返回的原始形状 —— 一切字段都当作不可信 */
interface RawMemory {
  kind?: string
  title?: string
  content?: string
  tags?: unknown
  sensitivity?: string
  confidence?: unknown
  importance?: unknown
  entities?: unknown
}

export interface ExtractorOptions {
  llm: LlmProvider
  config: ExtractionConfig
  /** 已有标签，喂给 prompt 引导复用 */
  existingTags?: () => string[]
  /** 查已存在的相关记忆，避免重复提取 */
  relatedMemories?: (conv: Conversation) => Array<{ title: string; kind: string }>
}

export class MemoryExtractor {
  constructor(private readonly opts: ExtractorOptions) {}

  async extract(conv: Conversation): Promise<ExtractionOutcome> {
    const started = Date.now()

    if (!this.opts.llm.enabled) {
      const memories = this.postProcess(extractByRules(conv))
      return { memories, method: 'rules', durationMs: Date.now() - started }
    }

    try {
      const { system, user } = buildExtractionPrompt({
        conversation: conv,
        existingTags: this.opts.existingTags?.(),
        relatedMemories: this.opts.relatedMemories?.(conv),
        maxMemories: this.opts.config.maxMemoriesPerConversation,
      })

      const result = await this.opts.llm.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { json: true, temperature: 0.1 },
      )

      const parsed = extractJson<{ memories?: RawMemory[] }>(result.text)
      if (!parsed) {
        log.warn('LLM 输出无法解析为 JSON，本次降级为规则提取')
        return {
          memories: this.postProcess(extractByRules(conv)),
          method: 'rules',
          durationMs: Date.now() - started,
          error: 'LLM 输出不是合法 JSON',
        }
      }

      const raw = Array.isArray(parsed.memories) ? parsed.memories : []
      const memories = this.postProcess(
        raw
          .map((r) => this.normalize(r, conv))
          .filter((m): m is ExtractedMemory => m !== null)
          .slice(0, this.opts.config.maxMemoriesPerConversation),
      )

      return {
        memories,
        method: 'llm',
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: Date.now() - started,
      }
    } catch (e) {
      log.warn(`LLM 提取失败，降级为规则提取：${String(e)}`)
      return {
        memories: this.postProcess(extractByRules(conv)),
        method: 'rules',
        durationMs: Date.now() - started,
        error: String(e instanceof Error ? e.message : e),
      }
    }
  }

  /** 把 LLM 的任意输出规整成合法的 ExtractedMemory，字段非法就丢弃整条 */
  private normalize(raw: RawMemory, conv: Conversation): ExtractedMemory | null {
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const content = typeof raw.content === 'string' ? raw.content.trim() : ''
    if (!title || !content) return null
    // 标题比正文还长说明模型没理解要求，这种条目质量通常也差
    if (title.length > 120) return null

    const kind = (VALID_KINDS.has(raw.kind as MemoryKind) ? raw.kind : 'fact') as MemoryKind

    const tags = Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter((t): t is string => typeof t === 'string').map(normalizeTag))]
          .filter(Boolean)
          .slice(0, 6)
      : []

    const sensitivity = (
      ['public', 'private', 'secret'].includes(raw.sensitivity as string)
        ? raw.sensitivity
        : 'private'
    ) as Sensitivity

    const entities = Array.isArray(raw.entities)
      ? raw.entities
          .map((e) => {
            const obj = e as { name?: unknown; kind?: unknown }
            const name = typeof obj.name === 'string' ? obj.name.trim() : ''
            if (!name || name.length > 80) return null
            const ekind = (
              VALID_ENTITY_KINDS.has(obj.kind as EntityKind) ? obj.kind : 'concept'
            ) as EntityKind
            return { name, kind: ekind }
          })
          .filter((e): e is { name: string; kind: EntityKind } => e !== null)
          .slice(0, 8)
      : []

    return {
      kind,
      title: truncate(title, 120),
      content,
      tags,
      sensitivity,
      confidence: clamp(toNumber(raw.confidence, 0.7)),
      importance: clamp(toNumber(raw.importance, 0.5)),
      entities,
      sourceMessageIds: conv.messages.slice(-3).map((m) => m.id),
    }
  }

  /**
   * 安全后处理 —— 这是最后一道闸门，LLM 说了不算。
   *
   * 模型经常把含 token 的内容标成 public。真让它落进明文库，
   * 用户的密钥就会出现在全文索引里、出现在 MCP 返回给其他 agent 的结果里。
   * 所以这里用正则重新扫一遍，只允许升级敏感度，绝不允许降级。
   */
  private postProcess(memories: ExtractedMemory[]): ExtractedMemory[] {
    if (!this.opts.config.redactCredentials) return memories

    return memories.map((m) => {
      const found = detectSecrets(`${m.title}\n${m.content}`)
      const strong = found.filter((f) => f.confidence >= 0.75)

      if (strong.length === 0) return m

      // credential 类型 + secret 敏感度：内容原样保留，由 store 层加密
      if (m.kind === 'credential' || m.sensitivity === 'secret') {
        return { ...m, sensitivity: 'secret' as Sensitivity }
      }

      // 非凭据记忆里夹带了密钥（比如一条部署步骤里贴了 token）：
      // 记忆本体保留，把密钥抹掉。不然为了一个 token 把整条操作步骤锁进保险箱，
      // 用户以后查部署流程还得解锁，体验很差。
      const { text } = redact(m.content)
      log.debug(`记忆「${m.title}」中检测到 ${strong.length} 处敏感信息，已抹除`)
      return {
        ...m,
        content: text,
        sensitivity: m.sensitivity === 'public' ? 'private' : m.sensitivity,
      }
    })
  }
}

function toNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

export * from './prompt.js'
export * from './types.js'
export { extractByRules }
