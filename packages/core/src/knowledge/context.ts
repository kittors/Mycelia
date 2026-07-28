/**
 * 块的语义增强。
 *
 * 结构分块（chunk.ts）解决了「切在哪」，但没解决另一半问题：
 * 一个块被单独取出来后，它经常是失去指代的。
 *
 *   > 「改完之后需要重启才能生效，否则旧连接会继续用缓存里的配置。」
 *
 * 这段话本身检索价值接近于零 —— 改完什么？重启什么？向量里没有任何线索，
 * 用户搜「Nginx 配置不生效」永远命中不到它。
 *
 * 解法是给每个块补一句「它在讲什么」，只参与嵌入，不进正文。
 * 检索时命中的是「原文 + 定位说明」的合成向量，返回给用户的仍是干净的原文。
 * 这样既提高召回，又不会让 LLM 生成的内容污染用户的文档。
 *
 * 模型不可用时降级为规则版（文档标题 + 标题路径拼接）—— 效果弱一些，
 * 但不会让整个索引流程卡住。离线可用是这个产品的底线。
 */

import { fastOptions, type LlmProvider } from '@mycelia/llm'
import type { KnowledgeConfig, LlmProviderConfig } from '@mycelia/shared'
import { createLogger, mapLimit, truncate } from '@mycelia/shared'
import type { RawChunk } from './chunk/index.js'

const log = createLogger('core:knowledge:context')

export interface ContextualizedChunk extends RawChunk {
  /** 供嵌入使用的文本：定位说明 + 原文。落库的正文仍是 chunk.content */
  embedText: string
  /** 这一句定位说明本身，UI 上作为检索结果的副标题显示 */
  context: string
}

export interface DocumentContext {
  title: string
  /** 文档级摘要，作为每个块的公共背景 */
  summary: string
}

const DOC_SUMMARY_PROMPT = `你在为一个本地知识库建立索引。

根据给出的文档标题、大纲和开头片段，用一到两句话说明这份文档是关于什么的。
要求：
- 只描述主题与适用场景，不要复述细节
- 出现具体的产品名、服务名、项目名时必须保留，它们是检索的关键锚点
- 直接输出这段话，不要任何前缀或解释`

const CHUNK_CONTEXT_PROMPT = `你在为文档片段补充检索用的定位说明。

给你一份文档的背景，以及其中的一个片段。用一句不超过 40 字的话说明：
这个片段在讲什么，属于文档的哪一部分。

要求：
- 补全片段里的指代（「改完之后」要说清是改完什么）
- 保留具体的名词：服务名、文件名、命令、报错信息
- 不要复述片段原文，只写定位说明
- 直接输出这句话，不要任何前缀`

/**
 * 生成文档级摘要。
 *
 * 只把大纲和开头喂给模型，而不是整篇 —— 一份 10 万字的文档，
 * 它的主题在前 2000 字和标题结构里已经足够清楚，全文投喂纯属浪费。
 */
export async function summarizeDocument(
  llm: LlmProvider,
  llmConfig: LlmProviderConfig,
  input: { title: string; text: string; headings: readonly string[] },
): Promise<DocumentContext> {
  const fallback: DocumentContext = { title: input.title, summary: '' }
  if (!llm.enabled) return fallback

  const outline = input.headings.slice(0, 40).join('\n')
  const opening = truncate(input.text, 2000)

  try {
    const res = await llm.chat(
      [
        { role: 'system', content: DOC_SUMMARY_PROMPT },
        {
          role: 'user',
          content: `文档标题：${input.title}\n\n大纲：\n${outline || '（无标题层级）'}\n\n开头片段：\n${opening}`,
        },
      ],
      fastOptions(llmConfig, { maxTokens: 200, temperature: 0.1 }),
    )
    return { title: input.title, summary: res.text.trim() }
  } catch (e) {
    log.warn(`文档摘要生成失败，降级为纯结构定位：${String(e)}`)
    return fallback
  }
}

/**
 * 给每个块补定位说明。
 *
 * 并发受限：索引一个大目录会产生成千上万次调用，放开并发会直接打爆限流。
 * 单块失败只降级这一块，不影响整批 —— 索引任务不该因为一次 429 就前功尽弃。
 */
export async function contextualizeChunks(
  llm: LlmProvider,
  llmConfig: LlmProviderConfig,
  doc: DocumentContext,
  chunks: readonly RawChunk[],
  opts: { concurrency?: number; enabled?: boolean; signal?: AbortSignal } = {},
): Promise<ContextualizedChunk[]> {
  const useLlm = (opts.enabled ?? true) && llm.enabled

  if (!useLlm) {
    return chunks.map((chunk) => {
      const context = ruleContext(doc, chunk)
      return { ...chunk, context, embedText: composeEmbedText(context, chunk.content) }
    })
  }

  return mapLimit(chunks as RawChunk[], opts.concurrency ?? 4, async (chunk) => {
    const context = await chunkContext(llm, llmConfig, doc, chunk, opts.signal)
    return { ...chunk, context, embedText: composeEmbedText(context, chunk.content) }
  })
}

async function chunkContext(
  llm: LlmProvider,
  llmConfig: LlmProviderConfig,
  doc: DocumentContext,
  chunk: RawChunk,
  signal?: AbortSignal,
): Promise<string> {
  const fallback = ruleContext(doc, chunk)
  try {
    const res = await llm.chat(
      [
        { role: 'system', content: CHUNK_CONTEXT_PROMPT },
        {
          role: 'user',
          content: [
            `文档：${doc.title}`,
            doc.summary ? `文档简介：${doc.summary}` : '',
            chunk.heading ? `所在章节：${chunk.heading}` : '',
            '',
            '片段：',
            truncate(chunk.content, 1200),
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      fastOptions(llmConfig, { maxTokens: 120, temperature: 0.1, signal }),
    )
    const text = res.text.trim()
    return text || fallback
  } catch {
    return fallback
  }
}

/** 无模型时的定位说明：文档标题 + 章节路径，聊胜于无 */
function ruleContext(doc: DocumentContext, chunk: RawChunk): string {
  const parts = [doc.title, chunk.heading].filter(Boolean)
  return parts.join(' › ')
}

function composeEmbedText(context: string, content: string): string {
  return context ? `${context}\n\n${content}` : content
}

/**
 * 判断文档是否「结构贫瘠」。
 *
 * 有标题层级的文档，沿标题切就已经很好了，没必要花模型调用。
 * 真正需要语义增强的是那种一泻千里的长文：没有标题、段落巨大，
 * 纯按字数切必然产生大量失去上下文的碎片。
 */
export function needsSemanticContext(text: string, chunkCount: number): boolean {
  const headingCount = (text.match(/^#{1,6}\s/gm) ?? []).length
  if (chunkCount <= 1) return false
  // 平均每块摊不到一个标题，说明结构撑不住分块粒度
  return headingCount < chunkCount * 0.5
}

/** 收集文档的标题行，用于生成大纲 */
export function collectHeadings(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    const level = match[1]!.length
    out.push(`${'  '.repeat(level - 1)}${match[2]!.trim()}`)
  }
  return out
}

export function chunkOptionsFrom(config: KnowledgeConfig) {
  return {
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  }
}
