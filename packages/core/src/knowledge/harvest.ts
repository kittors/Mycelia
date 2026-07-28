import type { LlmProvider } from '@mycelia/llm'
import type { Config } from '@mycelia/shared'
import { createLogger } from '@mycelia/shared'
import type { MyceliaStore, StoredDocument } from '@mycelia/store'
import { extractFromDocument } from '../extract/document.js'
import { normalizeRawMemory } from '../extract/types.js'

const log = createLogger('core:knowledge:harvest')

export interface HarvestResult {
  documentId: string
  /** 写进待确认队列的条数 */
  created: number
  /** 因为已经有几乎一样的记忆而跳过的条数 */
  duplicates: number
  error?: string
}

/**
 * 从一篇文档里提炼记忆，放进待确认队列。
 *
 * 为什么是「待确认」而不是直接入库：模型从文档里抽出来的东西，好的时候
 * 很好，差的时候会把章节标题改写一下就当成知识。直接进库意味着记忆库
 * 会被稀释 —— 而记忆库一旦装满了半真半假的条目，检索出来的东西就不敢信了，
 * 那才是这个产品真正的死因。
 *
 * 所以这里只负责「提出候选」，收不收由人定。已有的待确认页面正是它的去处。
 */
export async function harvestDocument(
  store: MyceliaStore,
  llm: LlmProvider,
  config: Config,
  document: StoredDocument,
  text: string,
): Promise<HarvestResult> {
  const result: HarvestResult = { documentId: document.id, created: 0, duplicates: 0 }

  const extracted = await extractFromDocument(llm, config.extraction, {
    title: document.title,
    text,
    existingTags: store.tags
      .usage()
      .slice(0, 40)
      .map((t) => t.tag),
  })

  if (extracted.error) {
    result.error = extracted.error
    return result
  }

  for (const raw of extracted.memories) {
    const memory = normalizeRawMemory(raw)
    if (!memory) continue

    /**
     * 同一篇文档反复索引（改一个错别字就会触发）不该反复产出同一批候选。
     * 按标题去重就够了 —— 模型对同一段内容给出的标题相当稳定，
     * 而真正的新内容几乎不会撞上旧标题。
     */
    if (store.memories.findByTitle(memory.title)) {
      result.duplicates++
      continue
    }

    store.memories.insert(
      {
        ...memory,
        // 待确认：进队列等人过目，不直接参与检索
        status: 'pending',
        origin: {
          agent: 'document',
          documentId: document.id,
          messageIds: [],
          excerpt: document.relPath,
        },
      },
      'harvest',
    )
    result.created++
  }

  if (result.created > 0) {
    log.info('已从文档提出候选记忆', {
      title: document.title,
      created: result.created,
      duplicates: result.duplicates,
    })
  }
  return result
}
