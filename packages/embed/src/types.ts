export interface Embedder {
  /** 模型标识，写进 memory_vectors.model；换模型时据此触发重新嵌入 */
  readonly id: string
  readonly dimensions: number
  /** 是否需要联网 / 需要下载模型 */
  readonly kind: 'local' | 'remote' | 'builtin'
  embed(texts: readonly string[]): Promise<Float32Array[]>
  /** 单条便捷方法 */
  embedOne(text: string): Promise<Float32Array>
  /** 资源释放（本地模型要卸载） */
  dispose?(): Promise<void>
}

export abstract class BaseEmbedder implements Embedder {
  abstract readonly id: string
  abstract readonly dimensions: number
  abstract readonly kind: 'local' | 'remote' | 'builtin'
  abstract embed(texts: readonly string[]): Promise<Float32Array[]>

  async embedOne(text: string): Promise<Float32Array> {
    const [v] = await this.embed([text])
    if (!v) throw new Error('嵌入失败：未返回向量')
    return v
  }
}

/** 嵌入前的文本预处理：截断 + 压缩空白，避免超长文本拖垮模型 */
export function prepareText(text: string, maxChars = 2000): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars)
}
