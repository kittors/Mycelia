/**
 * 界面截图。
 *
 * 走 Electron 的远程调试端口（CDP）而不是系统截屏 ——
 * 后者需要「屏幕录制」权限，在 CI 和无人值守环境里根本拿不到。
 * CDP 直接从渲染进程取帧，还能顺便注入脚本切主题、翻页面。
 *
 *   npx electron out/main/index.js --remote-debugging-port=9333 &
 *   node scripts/shoot-ui.mjs 9333 /tmp/shots
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const port = process.argv[2] ?? '9333'
const outDir = process.argv[3] ?? '/tmp/mycelia-shots'
mkdirSync(outDir, { recursive: true })

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  return res.json()
}

/** 一个极简的 CDP 客户端：够用就好，不值得为它引 puppeteer */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    let seq = 0
    const pending = new Map()

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    })
    socket.addEventListener('error', reject)
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const id = ++seq
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej })
            socket.send(JSON.stringify({ id, method, params }))
          })
        },
        close: () => socket.close(),
      }),
    )
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = (await listTargets()).filter((t) => t.type === 'page')
if (targets.length === 0) {
  console.error('没有找到页面，应用起来了吗？')
  process.exit(1)
}

for (const target of targets) {
  const client = await connect(target.webSocketDebuggerUrl)
  const label = target.title === '设置' ? 'settings' : 'main'

  // 两种主题各截一张 —— 配色问题往往只在其中一种下暴露
  for (const theme of ['dark', 'light']) {
    await client.send('Runtime.evaluate', {
      expression: `document.documentElement.dataset.theme = '${theme}'`,
    })
    await sleep(700)

    const { data } = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    const file = join(outDir, `${label}-${theme}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(`已保存 ${file}`)
  }

  client.close()
}
