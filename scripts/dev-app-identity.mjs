#!/usr/bin/env node
/**
 * 开发模式下把 Electron 的身份改成 Mycelia。
 *
 * 打包后不存在这个问题 —— productName 会写进 bundle。但开发时跑的是
 * Electron 自己那个 .app，Dock、访达、「强制退出」列表读的都是它的
 * Info.plist，显示成 Electron。`app.setName()` 管不到：那只影响菜单栏
 * 和 userData 路径，名字在进程起来之前就被系统读走了。
 *
 * 改的是本仓库 node_modules 里的副本，不碰全局 store，重装依赖后重跑即可。
 * 幂等，非 macOS 直接跳过。
 */

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'Mycelia'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 打包前必须先还原。
 *
 * electron-builder 是直接复制 node_modules 里那个 Electron.app 再改名的，
 * 撞上我们改过的可执行文件名就会 ENOENT 直接失败 —— arm64 侥幸能过，
 * x64 必挂。开发期的观感再重要，也不能拿发给用户的产物去换。
 */
const restore = process.argv.includes('--restore')

if (process.platform !== 'darwin') process.exit(0)

/** electron 是 pnpm 的软链，要顺着找到真正放 dist 的地方 */
let appPath
try {
  const entry = execFileSync('node', ['-e', "process.stdout.write(require.resolve('electron'))"], {
    cwd: join(root, 'apps/desktop'),
    encoding: 'utf8',
  })
  const dist = join(dirname(entry), 'dist')
  // 改过名之后就叫 Mycelia.app 了，两个都要认
  appPath = existsSync(join(dist, `${NAME}.app`))
    ? join(dist, `${NAME}.app`)
    : join(dist, 'Electron.app')
} catch {
  process.exit(0)
}

const plist = join(appPath, 'Contents', 'Info.plist')
if (!existsSync(plist)) process.exit(0)

const read = (key) => {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

const set = (key, value) => {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist])
  }
}

// 已经改过就直接走 —— 重签整个 bundle 要好几秒，不该每次 pnpm dev 都付这个代价
if (
  !restore &&
  appPath.endsWith(`${NAME}.app`) &&
  read('CFBundleName') === NAME &&
  read('CFBundleExecutable') === NAME &&
  read('CFBundleIdentifier') === 'dev.mycelia.app'
) {
  process.exit(0)
}

if (restore) {
  const macOSDir = join(appPath, 'Contents', 'MacOS')
  const renamed = join(macOSDir, NAME)
  const original = join(macOSDir, 'Electron')
  if (existsSync(renamed)) {
    if (existsSync(original)) rmSync(original)
    renameSync(renamed, original)
  }
  set('CFBundleExecutable', 'Electron')
  set('CFBundleIdentifier', 'com.github.Electron')
  const pathFile = resolve(appPath, '..', '..', 'path.txt')
  if (existsSync(pathFile)) {
    writeFileSync(pathFile, `Electron.app/Contents/MacOS/Electron`)
  }
  // 目录名也要还原：electron-builder 找的是 dist/Electron.app
  const originalApp = join(dirname(appPath), 'Electron.app')
  if (appPath !== originalApp && !existsSync(originalApp)) {
    renameSync(appPath, originalApp)
  }
  try {
    execFileSync('codesign', ['--force', '--sign', '-', '--deep', appPath], { stdio: 'ignore' })
  } catch {
    /* 同下 */
  }
  console.log('[dev] Electron 身份已还原，可以打包了')
  process.exit(0)
}

set('CFBundleName', NAME)
set('CFBundleDisplayName', NAME)
/**
 * bundle id 也要换。
 *
 * 留着 com.github.Electron 的话，Dock 会按这个 id 命中系统里那条早就存在的
 * 「Electron」记录，于是图标是我们的、名字却还是 Electron。跟打包产物用
 * 同一个 id，顺带让开发期的权限申请、单例锁都跟正式版一致。
 */
set('CFBundleIdentifier', 'dev.mycelia.app')

/**
 * 可执行文件也要改名。
 *
 * 开发时是直接执行 bundle 里的二进制，而不是 `open -a`，LaunchServices
 * 压根不会把它当成一个应用去注册（LSDisplayName 是空的），Dock 于是退回
 * 用进程名 —— 进程名取自可执行文件。光改 Info.plist 是看不到效果的。
 *
 * 原名留一个软链：electron 包的入口把 dist/Electron.app/Contents/MacOS/Electron
 * 这条路径写死在代码里，直接改名会让 `electron` 命令找不到二进制。
 */
const macOS = join(appPath, 'Contents', 'MacOS')
const original = join(macOS, 'Electron')
const renamed = join(macOS, NAME)
if (existsSync(original) && !existsSync(renamed)) {
  renameSync(original, renamed)
  symlinkSync(NAME, original)
  set('CFBundleExecutable', NAME)
}

// 图标也换掉，不然 Dock 上是 Electron 那个原子
const icon = join(root, 'apps/desktop/build/icon.icns')
const target = join(appPath, 'Contents', 'Resources', 'electron.icns')
if (existsSync(icon) && existsSync(target)) copyFileSync(icon, target)

/**
 * 连 .app 目录一起改名。
 *
 * 这是最后一块拼图，也是 VS Code 的做法（他们把 Electron.app 改成
 * Code - OSS.app）。只改 Info.plist 是不够的 —— 直接执行 bundle 里的
 * 二进制时，系统并不会把它当成一个正式启动的应用去读 plist，
 * Dock 于是退回用 .app 的目录名，也就是「Electron」。
 */
const renamedApp = join(dirname(appPath), `${NAME}.app`)
if (appPath !== renamedApp) {
  renameSync(appPath, renamedApp)
  appPath = renamedApp
}

/**
 * electron 包用 path.txt 记录二进制的位置，`electron` 命令读它来启动。
 * 不改这里的话，启动走的仍是那个软链，argv[0] 还是 Electron ——
 * 而 macOS 的进程名取自 argv[0]，不解析软链。
 */
const pathFile = resolve(appPath, '..', '..', 'path.txt')
if (existsSync(pathFile)) {
  const current = readFileSync(pathFile, 'utf8').trim()
  if (current !== `${NAME}.app/Contents/MacOS/${NAME}`) {
    writeFileSync(pathFile, `${NAME}.app/Contents/MacOS/${NAME}`)
  }
}

/**
 * 改完必须重新签名。macOS 会校验 bundle 内容与签名是否一致，
 * 动过 Info.plist 之后不重签，应用会直接起不来。
 */
try {
  execFileSync('codesign', ['--force', '--sign', '-', '--deep', appPath], { stdio: 'ignore' })
} catch {
  // 没有 codesign（少见）就算了，多数情况下 ad-hoc 签名不是硬性要求
}

/**
 * 让 LaunchServices 重读这个 bundle。
 *
 * 不刷新的话它会继续用缓存里那条旧记录 —— 改完 Info.plist、Dock 上
 * 依旧显示 Electron，就是这个原因。
 */
try {
  execFileSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', appPath],
    { stdio: 'ignore' },
  )
} catch {
  /* 刷不动就算了，重启 Dock 也能达到同样效果 */
}

try {
  execFileSync('touch', [appPath])
} catch {
  /* 无关紧要 */
}

console.log(`[dev] Electron 身份已改为 ${NAME}`)
