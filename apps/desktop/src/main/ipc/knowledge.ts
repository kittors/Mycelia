/**
 * 文件目录知识库：挂载、索引、检索。
 *
 * 索引任务同一时刻只允许一个 —— 嵌入是 CPU 密集的，
 * 并行两个目录只会互相抢核，总耗时不降反升。
 */

import { basename } from 'node:path'
import type { MemoryService } from '@mycelia/core'
import { createLogger } from '@mycelia/shared'
import { BrowserWindow, dialog } from 'electron'
import { broadcast, type Handle } from './registry.js'

const log = createLogger('main:ipc:knowledge')

export function registerKnowledgeHandlers(handle: Handle, service: MemoryService): void {
  /**
   * 当前索引任务的中断句柄。
   *
   * 只允许一个索引在跑：嵌入是 CPU 密集的，并行两个目录只会互相抢核，
   * 总耗时不降反升。新任务发起时先掐掉旧的。
   */
  let indexAbort: AbortController | null = null

  const runIndex = async (sourceId: string, force = false) => {
    indexAbort?.abort()
    const controller = new AbortController()
    indexAbort = controller

    broadcast({ type: 'index:start', sourceId })
    try {
      const result = await service.indexSource(sourceId, {
        force,
        signal: controller.signal,
        onProgress: (progress) => broadcast({ type: 'index:progress', ...progress }),
      })
      broadcast({ type: 'index:complete', result })
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      broadcast({ type: 'index:error', message })
      throw e
    } finally {
      if (indexAbort === controller) indexAbort = null
    }
  }

  handle('listSources', () => service.store.sources.all())

  handle('pickAndAddSource', async () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const picked = window
      ? await dialog.showOpenDialog(window, {
          title: '选择要索引的文档目录',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: '挂载',
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })

    if (picked.canceled || picked.filePaths.length === 0) return null
    const path = picked.filePaths[0]!
    const source = service.addSource({ name: basename(path) || path, path })

    // 挂载后立刻开始索引：用户选完目录的预期就是「它开始工作了」
    void runIndex(source.id).catch((e) => log.warn(`挂载后自动索引失败：${String(e)}`))
    return source
  })

  handle(
    'updateSource',
    (id: string, patch: Parameters<typeof service.store.sources.update>[1]) =>
      service.store.sources.update(id, patch) ?? null,
  )

  handle('removeSource', (id: string) => service.removeSource(id))
  handle('indexSource', (id: string, force = false) => runIndex(id, force))
  handle('cancelIndex', () => {
    indexAbort?.abort()
    indexAbort = null
  })

  handle('listDocuments', (sourceId: string) => service.store.documents.bySource(sourceId))

  handle('searchDocuments', (query: string, opts?: { limit?: number; sourceIds?: string[] }) =>
    service.searchDocuments(query, opts ?? {}),
  )

  handle('saveNote', (input: { title: string; text: string; documentId?: string }) =>
    service.library.saveNote(input),
  )

  handle('readNote', (documentId: string) => service.library.noteText(documentId) ?? null)

  handle('readDocument', async (documentId: string) => {
    const found = await service.library.documentText(documentId)
    if (!found) return null
    return {
      text: found.text,
      title: found.document.title,
      absPath: found.document.absPath,
      onDisk: found.onDisk,
    }
  })

  handle('harvestDocuments', async (documentIds: string[]) => {
    const results = await service.library.harvest(documentIds)
    return {
      created: results.reduce((sum, r) => sum + r.created, 0),
      duplicates: results.reduce((sum, r) => sum + r.duplicates, 0),
      failed: results.filter((r) => r.error).length,
    }
  })

  handle('writeDocument', (documentId: string, text: string) =>
    service.library.writeDocument(documentId, text),
  )
}
