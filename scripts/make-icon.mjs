/**
 * 应用图标生成。
 *
 * 走已经跑起来的 Electron 实例的调试端口（CDP）渲染 SVG 再截帧，
 * 而不是引 sharp/canvas —— 为生成几张图装一个原生依赖不划算，
 * 而这个仓库本来就要跑 Electron。
 *
 *   cd apps/desktop && npx electron out/main/index.js --remote-debugging-port=9333 &
 *   node scripts/make-icon.mjs 9333
 *
 * 产出 apps/desktop/build/icon.{svg,png,icns}。
 * Windows 的 .ico 由 electron-builder 从 png 自动转，不必在这里处理。
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = process.argv[2] ?? '9333'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'apps', 'desktop', 'build')
const SIZE = 1024
/**
 * macOS 图标规范：1024 画布里内容区约 824²，四周各留 100。
 * 画满整块画布的话，dock 里它会明显比其他应用大一圈。
 */
const PAD = 100
const INNER = SIZE - PAD * 2

/**
 * 菌丝网络：中心节点向外长出分支，末端结节，部分再分叉。
 *
 * 生成而不是手写路径 —— 角度、长度、粗细都是算出来的，
 * 想调密度只改参数，不必重画一遍。
 */
function renderSvg() {
  const c = SIZE / 2
  const nodes = []
  const edges = []

  const branches = 6
  for (let i = 0; i < branches; i++) {
    // 角度加一点扰动，否则六等分看起来像雪花，太死板
    const jitter = [0.12, -0.08, 0.05, -0.14, 0.09, -0.04][i] ?? 0
    const angle = (i / branches) * Math.PI * 2 - Math.PI / 2 + jitter
    const length = 268 + [0, 22, -16, 30, -8, 14][i]
    const x = c + Math.cos(angle) * length
    const y = c + Math.sin(angle) * length

    edges.push({ x1: c, y1: c, x2: x, y2: y, w: 15 })
    nodes.push({ x, y, r: 33 })

    // 二级枝只从其中三条主枝分出去，全都分会糊成一团
    if (i % 2 === 0) {
      for (const spread of [-0.62, 0.55]) {
        const subAngle = angle + spread
        const subLength = 128 + (spread > 0 ? 18 : 0)
        const sx = x + Math.cos(subAngle) * subLength
        const sy = y + Math.sin(subAngle) * subLength
        edges.push({ x1: x, y1: y, x2: sx, y2: sy, w: 9 })
        nodes.push({ x: sx, y: sy, r: 19 })
      }
    }
  }

  const lines = edges
    .map(
      (e) =>
        `<line x1="${e.x1.toFixed(1)}" y1="${e.y1.toFixed(1)}" x2="${e.x2.toFixed(1)}" y2="${e.y2.toFixed(1)}" stroke="url(#stroke)" stroke-width="${e.w}" stroke-linecap="round"/>`,
    )
    .join('')

  const dots = nodes
    .map((n) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="#f4f6f5"/>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c211f"/>
      <stop offset="1" stop-color="#080a09"/>
    </linearGradient>
    <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4f6f5" stop-opacity="0.92"/>
      <stop offset="1" stop-color="#f4f6f5" stop-opacity="0.55"/>
    </linearGradient>
  </defs>

  <!-- macOS 的 icns 不会自动裁角，圆角必须画进图里。185 ≈ 824 × 0.225，接近系统图标的圆度 -->
  <rect x="${PAD}" y="${PAD}" width="${INNER}" height="${INNER}" rx="185" fill="url(#bg)"/>

  <!-- 图案按 1024 坐标系画，再整体缩放进内容区，省得每个坐标都换算一遍 -->
  <g transform="translate(${PAD} ${PAD}) scale(${(INNER / SIZE).toFixed(4)})">
    ${lines}
    ${dots}
    <circle cx="${c}" cy="${c}" r="62" fill="#f4f6f5"/>
  </g>
</svg>`
}

// ── 极简 CDP 客户端 ──
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

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('没找到页面。先启动带 --remote-debugging-port 的 Electron。')
  process.exit(1)
}

mkdirSync(buildDir, { recursive: true })
const svg = renderSvg()
writeFileSync(join(buildDir, 'icon.svg'), svg)

const client = await connect(page.webSocketDebuggerUrl)

// 把视口改成正方形，截出来才是 1:1 不变形的图标
await client.send('Emulation.setDeviceMetricsOverride', {
  width: SIZE,
  height: SIZE,
  deviceScaleFactor: 1,
  mobile: false,
})

// 不覆盖成透明的话，截图会给圆角外面填一层白，dock 里就是个带白边的方块
await client.send('Emulation.setDefaultBackgroundColorOverride', {
  color: { r: 0, g: 0, b: 0, a: 0 },
})

await client.send('Runtime.evaluate', {
  expression: `
    document.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden'
    document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:transparent'
    document.body.innerHTML = ${JSON.stringify(svg)}
  `,
})
await new Promise((r) => setTimeout(r, 500))

const { data } = await client.send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
})
const pngPath = join(buildDir, 'icon.png')
writeFileSync(pngPath, Buffer.from(data, 'base64'))
console.log(`已生成 ${pngPath}`)

// 页面被我们改坏了，还原成正常应用界面
await client.send('Emulation.setDefaultBackgroundColorOverride')
await client.send('Emulation.clearDeviceMetricsOverride')
await client.send('Page.reload')
client.close()

// ── 打包成 icns：sips 缩放，iconutil 合成 ──
const iconset = join(buildDir, 'icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const names = [`icon_${size}x${size}.png`]
  // Retina 版：512@2x 就是 1024，以此类推
  if (size >= 32) names.push(`icon_${size / 2}x${size / 2}@2x.png`)
  for (const name of names) {
    execFileSync(
      'sips',
      ['-z', String(size), String(size), pngPath, '--out', join(iconset, name)],
      {
        stdio: 'ignore',
      },
    )
  }
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')])
rmSync(iconset, { recursive: true, force: true })
console.log(`已生成 ${join(buildDir, 'icon.icns')}`)
