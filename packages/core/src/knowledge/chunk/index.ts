/**
 * 文档分块。
 *
 * 碎片化是 RAG 最常见的失败方式：按固定长度硬切，一段代码被腰斩、
 * 一个表格只剩半张、一句结论和它的前提被分到两个块里。
 * 检索时每一块单独看都不知所云。
 *
 * 这里围绕三条原则：
 *
 *   1. **沿结构切，不沿字数切**（parse.ts）。先把文档解析成块序列，
 *      再沿这些天然边界打包。字数只是打包时的容量提示，不是切割位置。
 *
 *   2. **原子单元不可分割**。代码围栏、表格、列表整体保留，哪怕超出目标长度。
 *
 *   3. **块要知道自己在哪**。每块带完整的标题路径与字符区间。前者让块脱离文档后
 *      仍有上下文，后者让检索命中后能回溯取回整节原文（small-to-big）。
 *
 * 全程纯函数，不碰 IO 也不调模型 —— 这样它能被单测穷举各种畸形文档。
 * 需要模型参与的语义增强在 ../context.ts，是这一层之上的可选增益。
 */

import { parseBlocks } from './parse.js'
import { splitBySentence, takeTailSentences } from './split.js'
import { type ChunkOptions, type DocBlock, HEADING_SEPARATOR, type RawChunk } from './types.js'

export { parseBlocks } from './parse.js'
export { splitBySentence } from './split.js'
export type { ChunkOptions, DocBlock, RawChunk } from './types.js'

/**
 * 沿结构边界打包成块。
 *
 * 打包器维护一个标题栈：每遇到 N 级标题就弹掉所有 ≥N 级的旧标题再压入。
 * 这样每个块都能拿到「一级 › 二级 › 三级」的完整定位，而不只是最近的那个标题。
 */
export function chunkDocument(text: string, options: ChunkOptions): RawChunk[] {
  const { chunkSize, chunkOverlap } = options
  const minChunkSize = options.minChunkSize ?? Math.floor(chunkSize * 0.25)
  const blocks = parseBlocks(text)
  if (blocks.length === 0) return []

  const chunks: RawChunk[] = []
  const headingStack: Array<{ level: number; title: string }> = []

  let buffer: DocBlock[] = []
  let bufferLength = 0
  // 缓冲区建立时的标题路径。标题变了要先 flush，否则块会横跨两个小节
  let bufferHeading = ''

  const headingPath = () => headingStack.map((h) => h.title).join(HEADING_SEPARATOR)

  const flush = () => {
    if (buffer.length === 0) return
    const content = buffer
      .map((b) => b.text)
      .join('\n\n')
      .trim()
    if (content === '') {
      buffer = []
      bufferLength = 0
      return
    }

    const charStart = buffer[0]!.start
    const charEnd = buffer[buffer.length - 1]!.end
    const previous = chunks[chunks.length - 1]

    // 过短的块单独存在只会稀释检索结果，并回上一块。
    // 只在标题路径相同时合并 —— 否则会把两个小节黏在一起，反而破坏定位。
    if (content.length < minChunkSize && previous && previous.heading === bufferHeading) {
      previous.content = `${previous.content}\n\n${content}`
      previous.charEnd = charEnd
    } else {
      chunks.push({ ord: chunks.length, heading: bufferHeading, content, charStart, charEnd })
    }

    // 重叠：把尾部若干字符带进下一块，避免答案正好被切在边界上。
    // 只对非原子块做 —— 复制半个代码块进下一块没有意义。
    const tail = buffer[buffer.length - 1]!
    buffer = []
    bufferLength = 0
    if (chunkOverlap > 0 && !tail.atomic && tail.text.length > chunkOverlap) {
      const overlapText = takeTailSentences(tail.text, chunkOverlap)
      if (overlapText) {
        buffer = [
          {
            type: 'paragraph',
            text: overlapText,
            start: Math.max(tail.start, tail.end - overlapText.length),
            end: tail.end,
            atomic: false,
          },
        ]
        bufferLength = overlapText.length
      }
    }
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      // 标题本身不进正文缓冲，它通过 headingPath 体现在每个块上
      flush()
      const level = block.level ?? 1
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop()
      }
      headingStack.push({ level, title: block.text })
      bufferHeading = headingPath()
      continue
    }

    if (buffer.length === 0) bufferHeading = headingPath()

    // 单块就超出容量：原子块整块放行，普通段落按句子切开
    if (block.text.length > chunkSize) {
      flush()
      bufferHeading = headingPath()
      if (block.atomic) {
        chunks.push({
          ord: chunks.length,
          heading: bufferHeading,
          content: block.text,
          charStart: block.start,
          charEnd: block.end,
        })
      } else {
        for (const piece of splitBySentence(block.text, chunkSize, chunkOverlap)) {
          chunks.push({
            ord: chunks.length,
            heading: bufferHeading,
            content: piece.text,
            charStart: block.start + piece.offset,
            charEnd: block.start + piece.offset + piece.text.length,
          })
        }
      }
      continue
    }

    if (bufferLength + block.text.length > chunkSize) flush()
    if (buffer.length === 0) bufferHeading = headingPath()
    buffer.push(block)
    bufferLength += block.text.length + 2
  }

  flush()
  return chunks.map((chunk, index) => ({ ...chunk, ord: index }))
}
