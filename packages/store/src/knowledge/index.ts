/**
 * 文件目录知识库的数据访问层。
 *
 * 三个聚合，各管一层：
 *   sources    被挂载的目录
 *   documents  目录下的文件（含整体替换的事务边界）
 *   chunks     文件切出来的块（检索的最小单位）
 */

export { ChunkRepo } from './chunks.js'
export { DocumentRepo, type ReplaceResult } from './documents.js'
export { SourceRepo } from './sources.js'
export type {
  ChunkInput,
  SourceStatus,
  StoredChunk,
  StoredDocument,
  StoredSource,
} from './types.js'
