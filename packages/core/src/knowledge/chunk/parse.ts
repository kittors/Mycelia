/**
 * markdown / 纯文本 → 结构块序列。
 *
 * 手写扫描器而不是引 remark：这里只需要识别边界，不需要完整 AST。
 * 一个百来行的扫描器换掉一棵依赖树，对 Electron 打包体积也友好。
 *
 * 识别出的原子块（代码围栏、表格、列表）在打包阶段绝不会被切开 ——
 * 一个完整但偏长的代码块，永远比两个各缺一半的有用。
 */

import type { DocBlock } from './types.js'

export function parseBlocks(text: string): DocBlock[] {
  const blocks: DocBlock[] = []
  const lines = text.split('\n')

  // 行号 → 字符偏移，用于给每个块标注原文区间
  const lineOffsets: number[] = []
  let offset = 0
  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + 1
  }
  const offsetAt = (lineIndex: number) => lineOffsets[lineIndex] ?? text.length

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed === '') {
      i++
      continue
    }

    // ── 代码围栏：整体原子，围栏内的一切都不解析 ──
    const fence = trimmed.match(/^(```+|~~~+)/)
    if (fence) {
      const marker = fence[1]!
      const startLine = i
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) i++
      const endLine = Math.min(i, lines.length - 1)
      i++ // 吃掉结束围栏
      blocks.push({
        type: 'code',
        text: lines.slice(startLine, Math.min(i, lines.length)).join('\n'),
        start: offsetAt(startLine),
        end: offsetAt(endLine) + (lines[endLine]?.length ?? 0),
        atomic: true,
      })
      continue
    }

    // ── 标题 ──
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        text: heading[2]!.trim(),
        start: offsetAt(i),
        end: offsetAt(i) + line.length,
        atomic: true,
      })
      i++
      continue
    }

    // ── 表格：连续的 | 开头行，整张表原子 ──
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const startLine = i
      while (i < lines.length && lines[i]!.trim().startsWith('|')) i++
      blocks.push({
        type: 'table',
        text: lines.slice(startLine, i).join('\n'),
        start: offsetAt(startLine),
        end: offsetAt(i - 1) + (lines[i - 1]?.length ?? 0),
        atomic: true,
      })
      continue
    }

    // ── 列表：连续的列表项（含缩进续行）视为一个整体 ──
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const startLine = i
      while (i < lines.length) {
        const candidate = lines[i]!
        const isItem = /^\s*([-*+]|\d+[.)])\s+/.test(candidate)
        const isContinuation = /^\s+\S/.test(candidate)
        const isBlank = candidate.trim() === ''
        // 空行后若不再是列表项，列表就结束了
        if (isBlank) {
          const next = lines[i + 1]
          if (!next || !/^\s*([-*+]|\d+[.)])\s+/.test(next)) break
        } else if (!isItem && !isContinuation) break
        i++
      }
      blocks.push({
        type: 'list',
        text: lines.slice(startLine, i).join('\n').trimEnd(),
        start: offsetAt(startLine),
        end: offsetAt(Math.max(startLine, i - 1)) + (lines[i - 1]?.length ?? 0),
        atomic: true,
      })
      continue
    }

    // ── 引用 ──
    if (trimmed.startsWith('>')) {
      const startLine = i
      while (i < lines.length && lines[i]!.trim().startsWith('>')) i++
      blocks.push({
        type: 'quote',
        text: lines.slice(startLine, i).join('\n'),
        start: offsetAt(startLine),
        end: offsetAt(i - 1) + (lines[i - 1]?.length ?? 0),
        atomic: false,
      })
      continue
    }

    // ── 普通段落：到空行或下一个结构元素为止 ──
    const startLine = i
    while (i < lines.length) {
      const candidate = lines[i]!
      if (candidate.trim() === '') break
      if (i > startLine && isStructuralStart(candidate)) break
      i++
    }
    blocks.push({
      type: 'paragraph',
      text: lines.slice(startLine, i).join('\n'),
      start: offsetAt(startLine),
      end: offsetAt(i - 1) + (lines[i - 1]?.length ?? 0),
      atomic: false,
    })
  }

  return blocks
}

/** 这一行是否开启了新的结构元素 —— 段落遇到它就该断开 */
function isStructuralStart(line: string): boolean {
  const trimmed = line.trim()
  return (
    /^(#{1,6})\s/.test(trimmed) ||
    /^(```+|~~~+)/.test(trimmed) ||
    trimmed.startsWith('|') ||
    trimmed.startsWith('>') ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line)
  )
}
