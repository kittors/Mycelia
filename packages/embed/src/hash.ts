import { BaseEmbedder, prepareText } from './types.js'

/**
 * 零依赖的哈希嵌入（特征哈希 / hashing trick）。
 *
 * 定位：**保底方案**，让 Mycelia 在没配任何模型的情况下也能跑起来。
 * 原理是把 n-gram 特征哈希到固定维度并做 TF 加权，本质是稀疏词袋的稠密投影 ——
 * 它能捕捉词面重合，但捕捉不到「Electron 白屏」和「渲染进程加载失败」的语义等价。
 *
 * 中文按 bigram 切，英文按词切；两者混排的技术文本正是这里的主要输入。
 * 配合 FTS 全文检索做混合召回，实际效果比纯 BM25 略好，远不如真模型。
 * 桌面端会在设置页明确提示用户升级到本地模型或 API。
 */
export class HashEmbedder extends BaseEmbedder {
  readonly id: string
  readonly dimensions: number
  readonly kind = 'builtin' as const

  constructor(dimensions = 384) {
    super()
    this.dimensions = dimensions
    this.id = `hash-${dimensions}`
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.embedSync(t))
  }

  embedSync(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions)
    const tokens = tokenize(prepareText(text, 4000))
    if (tokens.length === 0) return vec

    // 词频统计 —— 重复出现的术语应该获得更高权重
    const counts = new Map<string, number>()
    for (const tok of tokens) counts.set(tok, (counts.get(tok) ?? 0) + 1)

    for (const [token, count] of counts) {
      // 每个特征投影到 2 个位置并带符号，降低哈希碰撞造成的信息损失
      const h1 = fnv1a(token)
      const h2 = fnv1a(`${token}#2`)
      const weight = 1 + Math.log(count)
      vec[h1 % this.dimensions]! += weight * (h1 & 1 ? 1 : -1)
      vec[h2 % this.dimensions]! += weight * 0.5 * (h2 & 1 ? 1 : -1)
    }

    return vec
  }
}

/**
 * 混合分词。
 * 中文用 bigram（「知识图谱」→ 知识/识图/图谱），英文/数字按词边界切并转小写。
 * 同时保留 3-gram 的中文特征，让「知识图谱」比「知识产权」更接近。
 */
function tokenize(text: string): string[] {
  const out: string[] = []
  const lower = text.toLowerCase()

  // 英文单词、数字、路径、标识符
  for (const m of lower.matchAll(/[a-z0-9][a-z0-9_./-]{1,}/g)) {
    out.push(m[0])
    // 长标识符再拆一次：src/components/Graph → src, components, graph
    if (m[0].length > 6) for (const seg of m[0].split(/[_./-]/)) if (seg.length > 2) out.push(seg)
  }

  // CJK 连续片段的 bigram + trigram
  for (const m of text.matchAll(/[一-鿿぀-ヿ]{2,}/g)) {
    const s = m[0]
    for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2))
    for (let i = 0; i + 2 < s.length; i++) out.push(s.slice(i, i + 3))
  }

  return out
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
