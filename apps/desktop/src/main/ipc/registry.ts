/**
 * IPC 注册的基础设施。
 *
 * 所有 handler 共用同一套错误处理：把错误原样抛回渲染层。
 * 前端才能给出准确提示，而不是笼统的「操作失败」。
 */

import { createLogger } from '@mycelia/shared'
import { BrowserWindow, ipcMain } from 'electron'

const log = createLogger('main:ipc')

export type Handle = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void

export function createHandle(): Handle {
  return (channel, fn) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        log.warn(`${channel} 失败：${message}`)
        throw new Error(message)
      }
    })
  }
}

/** 向所有窗口推送事件 */
export function broadcast(event: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mycelia:event', event)
  }
}
