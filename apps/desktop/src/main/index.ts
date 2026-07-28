import { MemoryService } from '@mycelia/core'
import { Scheduler } from '@mycelia/daemon'
import { createLogger } from '@mycelia/shared'
import { app, nativeTheme } from 'electron'
import { registerAssetScheme, serveAssets } from './ipc/assets.js'
import { broadcast, registerHandlers } from './ipc/index.js'
import { buildMenu } from './menu.js'
import { applyDevIcon, createMainWindow, hasOpenWindows } from './windows.js'

const log = createLogger('desktop')
let service: MemoryService | null = null
let scheduler: Scheduler | null = null

/**
 * 应用名必须在 whenReady 之前设定。
 *
 * 晚于它的话，菜单栏首项和部分系统 UI 已经用启动时的名字定好了，
 * 再改也不会回溯 —— 表现就是菜单里还挂着 "Electron"。
 *
 * 注意 dock 悬停与 ⌘Tab 显示的名字来自 bundle 的 CFBundleName，
 * 开发模式下跑的是 Electron.app 这个壳，那里改不掉；
 * 打包后走 productName，就是 Mycelia。
 */
app.setName('Mycelia')

/**
 * asset:// 的 scheme 必须在 whenReady 之前登记。
 *
 * 晚了会静默失效 —— 协议注册不报错，但所有图片都加载不出来，
 * 而且控制台里没有任何线索。
 */
registerAssetScheme()

app
  .whenReady()
  .then(() => {
    // 图片经自定义协议回传：渲染进程不碰磁盘，主进程是唯一的读取方
    serveAssets()

    // 跟随系统。用户在设置里选了固定主题时，渲染层自己覆盖 data-theme
    nativeTheme.themeSource = 'system'

    app.setAboutPanelOptions({
      applicationName: 'Mycelia',
      applicationVersion: app.getVersion(),
      copyright: '连接所有 agent 知识的地下菌丝网络',
    })
    applyDevIcon()

    service = MemoryService.open()
    scheduler = new Scheduler(service, {
      onStart: () => broadcast({ type: 'sync:start' }),
      onProgress: (done, total, current) =>
        broadcast({ type: 'sync:progress', done, total, current }),
      onComplete: (summary) => broadcast({ type: 'sync:complete', summary }),
      onError: (error) => broadcast({ type: 'sync:error', message: error.message }),
    })
    registerHandlers(service, scheduler)

    /**
     * 会话日志导入默认关闭 —— 记忆的主路径是 agent 通过 MCP 主动写入，
     * 后台把本地日志整个扒一遍是相反的思路。用户显式开启后才启动调度器。
     */
    if (service.config.ingest.enabled) {
      scheduler.start({ runImmediately: false, watch: true })
    }

    buildMenu()
    createMainWindow()

    app.on('activate', () => {
      if (!hasOpenWindows()) createMainWindow()
    })
  })
  .catch((error) => {
    log.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
  service?.close()
  scheduler = null
  service = null
})
