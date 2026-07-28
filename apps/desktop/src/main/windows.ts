/**
 * 窗口管理。
 *
 * 只有主窗口。设置是主窗口内的一层，不是独立窗口 ——
 * 独立窗口意味着两个 React 根、两份状态，在设置里改主题主界面收不到。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'

let mainWindow: BrowserWindow | null = null

const preload = () => join(__dirname, '../preload/index.js')

/** 应用图标。打包后由 electron-builder 处理，开发时要手动喂给 dock */
const iconPath = () => join(__dirname, '../../build/icon.png')

/**
 * 开发期的 dock 图标。
 *
 * 打包后 macOS 从 .app 的 Info.plist 读图标，这里不用管；
 * 但 `electron .` 直接跑时 dock 显示的是 Electron 默认图标，
 * 每次调试都看到别人的 logo 很出戏。
 */
export function applyDevIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged) return
  const icon = iconPath()
  if (existsSync(icon)) app.dock?.setIcon(icon)
}

/** Windows / Linux 的任务栏图标要在窗口上指定，macOS 由 .app 决定 */
function windowIcon(): string | undefined {
  if (process.platform === 'darwin') return undefined
  const icon = iconPath()
  return existsSync(icon) ? icon : undefined
}

function baseWebPreferences() {
  return {
    preload: preload(),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  }
}

/** 首帧背景跟随系统深浅，否则冷启动会闪一下白 */
function backgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff'
}

/** 开发模式下渲染层由 vite 提供，生产则加载打包产物 */
function loadPage(window: BrowserWindow, page: 'index'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, `../renderer/${page}.html`))
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    // 这是个常驻查阅的工具，不是要占满屏幕的编辑器。
    // 开得太大会逼着用户先去调窗口，反而增加一步。
    width: 1080,
    height: 700,
    minWidth: 860,
    minHeight: 560,
    show: false,
    icon: windowIcon(),
    backgroundColor: backgroundColor(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 13, y: 12 },
    webPreferences: baseWebPreferences(),
  })

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  loadPage(window, 'index')
  mainWindow = window
  return window
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function hasOpenWindows(): boolean {
  return BrowserWindow.getAllWindows().length > 0
}
