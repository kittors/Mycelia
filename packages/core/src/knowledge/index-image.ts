/**
 * 图片索引。
 *
 * 从 indexer 里分出来：那条流水线关心的是文本文档怎么切怎么嵌，
 * 而图片得先过一道视觉模型才变成文本 —— 前半段完全不同，
 * 后半段（分块、向量化、落库）才汇合。
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { VisionProvider } from '@mycelia/llm'
import type { Config } from '@mycelia/shared'
import type { MyceliaStore, StoredSource } from '@mycelia/store'
import type { IndexOptions } from './indexer.js'
import type { ScannedFile } from './scan.js'

export interface ImageIndexContext {
  store: MyceliaStore
  config: Config
  vision: VisionProvider
  /** 复用文本管线的后半段：分块 → 上下文增强 → 嵌入 → 落库 */
  ingestText: (
    source: StoredSource,
    meta: {
      relPath: string
      absPath: string
      title?: string
      sizeBytes?: number
      mtime?: number
      contentHash?: string
    },
    raw: string,
    opts?: IndexOptions,
  ) => Promise<{ skipped: boolean; chunkCount: number; contextualized: number }>
}

/**
 * 索引一张图片。
 *
 * 图片进不了向量空间 —— 嵌入模型吃的是文本。所以先让视觉模型把它
 * 转述成文字，那段文字才是真正被分块、被向量化、被检索到的东西。
 * 于是搜「登录流程」能命中一张流程图截图，哪怕它文件名叫 IMG_2043.png。
 *
 * 没配识图模型时退化成只登记文件名：按文件名仍然搜得到，
 * 内容搜不到。这比直接跳过好 —— 至少用户知道这张图在库里。
 */
export async function indexImage(
  ctx: ImageIndexContext,
  source: StoredSource,
  file: ScannedFile,
  opts: IndexOptions,
): Promise<{ skipped: boolean; chunkCount: number; contextualized: number }> {
  const limitKb = ctx.config.knowledge.maxImageSizeKb
  if (file.sizeBytes > limitKb * 1024) {
    return { skipped: true, chunkCount: 0, contextualized: 0 }
  }

  const bytes = await readFile(file.absPath)
  const contentHash = createHash('sha256').update(bytes).digest('hex')

  /**
   * 哈希命中就跳过。
   *
   * 对图片这尤其重要：重新索引一个目录时，没变过的图不该再花一次
   * 识图的钱。内容哈希比 mtime 可靠 —— 同步盘和 git checkout 都会
   * 改 mtime 而不动内容。
   */
  const existing = ctx.store.documents.byRelPath(source.id, file.relPath)
  if (!opts.force && existing?.contentHash === contentHash) {
    return { skipped: true, chunkCount: 0, contextualized: 0 }
  }

  const name = basename(file.relPath)
  const mime = `image/${extname(file.relPath).replace(/^\./, '').toLowerCase().replace('jpg', 'jpeg')}`

  let description = ''
  if (ctx.vision.enabled) {
    // 文件名和所在目录常常就是最好的提示（「架构图/网关.png」）
    description = await ctx.vision.describe(
      { base64: bytes.toString('base64'), mime },
      `文件路径：${file.relPath}`,
    )
  }

  /**
   * 组织成 Markdown 再走通用管线。
   *
   * 不为图片单开一套分块与落库逻辑 —— 那会分裂出第二种文档形态，
   * 检索、阅读、扩展上下文全都要各写一遍。转成 Markdown 之后，
   * 它就是一篇普通文档，只是正文由模型生成。
   */
  const body = description
    ? `![${name}](${file.absPath})\n\n${description}`
    : `![${name}](${file.absPath})\n\n（未启用识图，仅登记文件名）`

  return ctx.ingestText(
    source,
    {
      relPath: file.relPath,
      absPath: file.absPath,
      title: name,
      sizeBytes: file.sizeBytes,
      mtime: file.mtime,
      contentHash,
    },
    `# ${name}\n\n${body}`,
    { ...opts, force: true },
  )
}
