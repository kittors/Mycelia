/**
 * 超长段落的兜底切分。
 *
 * 走到这里说明单个段落本身就超过了目标长度，结构上已经没有更细的边界可用。
 * 那就沿句子切 —— 中英文标点都认，实在找不到边界才硬切。
 */

/** 按句子边界切超长文本，返回片段及其在原文中的偏移 */
export function splitBySentence(
  text: string,
  maxLength: number,
  overlap: number,
): Array<{ text: string; offset: number }> {
  const pieces: Array<{ text: string; offset: number }> = []

  // 句末标点后紧跟的位置就是候选切点
  const boundary = /[。！？；.!?;]\s*|\n+/g
  const points: number[] = []
  let match = boundary.exec(text)
  while (match) {
    points.push(match.index + match[0].length)
    match = boundary.exec(text)
  }
  points.push(text.length)

  let start = 0
  while (start < text.length) {
    const limit = start + maxLength

    // 取不超过容量的最远句边界；一个都没有就硬切
    let cut = points.find((p) => p > start && p <= limit)
    for (const p of points) {
      if (p > start && p <= limit && p > (cut ?? 0)) cut = p
    }
    if (cut === undefined || cut <= start) cut = Math.min(limit, text.length)

    const slice = text.slice(start, cut).trim()
    if (slice) pieces.push({ text: slice, offset: text.indexOf(slice, start) })
    if (cut >= text.length) break
    start = Math.max(start + 1, cut - overlap)
  }

  return pieces
}

/** 从文本尾部取出不超过 limit 的完整句子，用作下一块的重叠前缀 */
export function takeTailSentences(text: string, limit: number): string {
  const tail = text.slice(-limit)
  const boundary = tail.search(/[。！？；.!?;]\s*/)
  if (boundary === -1) return tail.trim()
  return tail.slice(boundary + 1).trim()
}
