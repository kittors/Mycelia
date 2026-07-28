/** 文档分块的中间表示 */

/** 文档解析后的最小结构单元 */
export interface DocBlock {
  type: 'heading' | 'paragraph' | 'code' | 'table' | 'list' | 'quote'
  /** 仅 heading 有：1~6 */
  level?: number
  text: string
  start: number
  end: number
  /** 原子单元：宁可超长也不切开 */
  atomic: boolean
}

/** 打包后的块。charStart/charEnd 让检索命中后能回溯取回原文 */
export interface RawChunk {
  ord: number
  /** 标题路径，如「部署 › 生产环境 › 回滚」 */
  heading: string
  content: string
  charStart: number
  charEnd: number
}

export interface ChunkOptions {
  chunkSize: number
  chunkOverlap: number
  /** 小于此长度的块会尝试与相邻块合并，避免产生检索噪音 */
  minChunkSize?: number
}

/** 标题路径的层级分隔符 */
export const HEADING_SEPARATOR = ' › '
