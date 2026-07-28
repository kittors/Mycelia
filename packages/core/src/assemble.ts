/**
 * 服务组件的装配。
 *
 * MemoryService 的构造过程就是把十来个协作对象按依赖顺序连起来。
 * 这段接线逻辑单独拿出来，好处是：读 MemoryService 时能直接看到它提供什么能力，
 * 而不用先趟过一屏 new；改依赖关系时也只需要动这一个文件。
 */

import { createEmbedder, type Embedder, withFallback } from '@mycelia/embed'
import { IngestService } from '@mycelia/ingest'
import { createLlm, createVision, type LlmProvider } from '@mycelia/llm'
import type { Config } from '@mycelia/shared'
import type { MyceliaStore } from '@mycelia/store'
import { CaptureGate } from './capture.js'
import { MemoryExtractor } from './extract/index.js'
import { GraphBuilder } from './graph/build.js'
import { DocumentIndexer, DocumentSearcher, KnowledgeLibrary } from './knowledge/index.js'
import { ExtractionPipeline } from './pipeline.js'
import { Retriever } from './retrieval.js'

export interface ServiceParts {
  embedder: Embedder
  llm: LlmProvider
  retriever: Retriever
  ingest: IngestService
  graphBuilder: GraphBuilder
  indexer: DocumentIndexer
  docSearch: DocumentSearcher
  library: KnowledgeLibrary
  captureGate: CaptureGate
  extractor: MemoryExtractor
  pipeline: ExtractionPipeline
}

export function assembleService(store: MyceliaStore, config: Config): ServiceParts {
  // 嵌入器套一层降级：远程 API 抽风时单批失败不该让整条流水线崩掉
  const embedder = withFallback(createEmbedder(config.embedding))
  const llm = createLlm(config.llm)

  /**
   * 识图交给索引器，用于把目录里的图片转成可检索的文字。
   * 没在设置里启用时 createVision 会返回空实现，索引图片时只登记文件名。
   */
  const vision = createVision(config.vision, {
    baseUrl: config.llm.baseUrl,
    apiKey: process.env[config.llm.apiKeyEnv] || config.llm.apiKey,
  })
  const indexer = new DocumentIndexer(store, embedder, llm, config, vision)
  const docSearch = new DocumentSearcher(store, embedder, config.retrieval, config.knowledge)

  const extractor = new MemoryExtractor({
    llm,
    config: config.extraction,
    // 把已有标签喂给提取器，避免它每次都发明新词
    existingTags: () =>
      store.tags
        .usage()
        .slice(0, 40)
        .map((tag) => tag.tag),
    relatedMemories: (conversation) =>
      store.memories
        .list({ project: conversation.project, limit: 10, orderBy: 'importance' })
        .map((memory) => ({ title: memory.title, kind: memory.kind })),
  })

  return {
    embedder,
    llm,
    retriever: new Retriever(store, embedder, config.retrieval),
    ingest: new IngestService(store, config),
    graphBuilder: new GraphBuilder(store, config.graph),
    indexer,
    docSearch,
    library: new KnowledgeLibrary(store, indexer, docSearch, config, llm),
    captureGate: new CaptureGate(store, embedder, llm, config.capture, config.llm),
    extractor,
    pipeline: new ExtractionPipeline(store, extractor, embedder, config),
  }
}
