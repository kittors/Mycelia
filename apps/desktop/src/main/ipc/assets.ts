/**
 * 图片资源。
 *
 * 图片存文件系统而不是数据库：SQLite 里塞大 blob 会让库文件迅速膨胀，
 * 备份、迁移、WAL 检查点全跟着变慢，而这些字节从来不参与查询。
 * 库里只留一个 `asset://` 引用。
 *
 * 渲染进程不能直接读本地文件（也不该给它这个权限），所以图片经由
 * 自定义协议回传 —— 主进程是唯一碰磁盘的地方。
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { MemoryService } from '@mycelia/core'
import { createVision } from '@mycelia/llm'
import { assetsDir, createLogger } from '@mycelia/shared'
import { protocol } from 'electron'
import type { Handle } from './registry.js'

const log = createLogger('ipc:assets')

/** 允许的图片类型。不接受 svg —— 它能内嵌脚本，等于给知识库开了个 XSS 口子 */
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

/** 单张图上限。再大的图对识图和阅读都没有增益，只会拖慢一切 */
const MAX_BYTES = 12 * 1024 * 1024

/**
 * 注册 asset:// 协议。
 *
 * 必须在 app.whenReady 之前登记 scheme，之后才能挂处理器 ——
 * 这是 Electron 的硬性要求，晚了会静默失效（图片全部加载不出来，
 * 且没有任何报错）。
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'asset',
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
    },
  ])
}

export function serveAssets(): void {
  protocol.handle('asset', async (request) => {
    try {
      const name = decodeURIComponent(new URL(request.url).hostname || '')
      // 只允许我们自己生成的文件名形态，杜绝 ../ 之类的路径穿越
      if (!/^[a-f0-9]{16,64}\.[a-z]{3,4}$/.test(name)) {
        return new Response('bad request', { status: 400 })
      }
      const file = join(assetsDir(), name)
      if (!existsSync(file)) return new Response('not found', { status: 404 })

      const mime = MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream'
      return new Response(await readFile(file), { headers: { 'content-type': mime } })
    } catch (error) {
      log.warn(`资源读取失败：${error instanceof Error ? error.message : String(error)}`)
      return new Response('error', { status: 500 })
    }
  })
}

export function registerAssetHandlers(handle: Handle, service: MemoryService): void {
  /**
   * 存一张图，返回可直接用在 Markdown 里的 asset:// 地址。
   *
   * 文件名用内容哈希：同一张图反复粘贴只会存一份，而且天然幂等 ——
   * 重复导入同一份文档不会攒出一堆副本。
   */
  handle('saveImage', async (input: { base64: string; ext: string }) => {
    const buffer = Buffer.from(input.base64, 'base64')
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error(`图片超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB`)
    }

    const ext = input.ext.startsWith('.') ? input.ext.toLowerCase() : `.${input.ext.toLowerCase()}`
    if (!MIME_BY_EXT[ext]) throw new Error(`不支持的图片格式：${ext}`)

    const name = `${createHash('sha256').update(buffer).digest('hex').slice(0, 32)}${ext}`
    const dir = assetsDir()
    await mkdir(dir, { recursive: true })

    const file = join(dir, name)
    if (!existsSync(file)) await writeFile(file, buffer)

    return { url: `asset://${name}`, name }
  })

  /**
   * 让视觉模型描述一张图。
   *
   * 描述会被写进 Markdown 的图片替代文字里，跟着正文一起分块与向量化 ——
   * 这样搜「架构图」才可能命中一张没有任何文字说明的白板照片。
   */
  handle('describeImage', async (input: { base64: string; mime: string; hint?: string }) => {
    const config = service.config
    const vision = createVision(config.vision, {
      baseUrl: config.llm.baseUrl,
      apiKey: process.env[config.llm.apiKeyEnv] || config.llm.apiKey,
    })
    if (!vision.enabled) return { text: '', enabled: false }

    const text = await vision.describe({ base64: input.base64, mime: input.mime }, input.hint)
    return { text, enabled: true }
  })
}
