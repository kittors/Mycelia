#!/usr/bin/env node
/**
 * 把原生模块拉回 Node 的 ABI。
 *
 * better-sqlite3 这类原生模块得针对具体运行时编译，而 Electron 和 Node 的
 * ABI 版本号不是一回事（Electron 33 是 130，Node 24 是 137）。打一次桌面包，
 * electron-builder 就会把它重建成 Electron ABI —— 之后再跑 `pnpm test`，
 * 模块加载直接失败，报错还长得像是环境坏了。
 *
 * 两套 ABI 没法共存（pnpm 的 isolated 布局下所有包共享同一份 .node），
 * 所以只能在跑测试前检查一次、不对就换回来。换回来靠下载预编译包，
 * 通常两三秒，比让人自己去查为什么测试突然挂了便宜得多。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'packages/store/package.json'))

let modulePath
try {
  modulePath = require.resolve('better-sqlite3')
} catch {
  // 没装就没什么可修的，让后面的构建自己去报错
  process.exit(0)
}

/**
 * 先补签名，再检测。
 *
 * 顺序不能反：签名失效时 `new Database()` 会让内核直接 SIGKILL 整个进程 ——
 * 下面那个 try/catch 根本没机会运行，脚本自己先死了，而且死得悄无声息。
 * 签名是幂等的，先做一遍不亏。
 */
execFileSync('node', [join(root, 'scripts', 'sign-native.mjs')], { stdio: 'inherit' })

try {
  /**
   * 必须真的开一个库。
   *
   * better-sqlite3 的 require 只加载 JS 那层，.node 要等到 new Database()
   * 才 dlopen —— 光 require 成功什么都说明不了，ABI 不对照样能过。
   */
  const Database = require('better-sqlite3')
  new Database(':memory:').close()
  process.exit(0)
} catch (error) {
  const message = String(error?.message ?? '')
  const abiMismatch = message.includes('NODE_MODULE_VERSION')
  if (!abiMismatch) {
    // 架构不对、文件损坏之类的问题不该在这里悄悄「修」——原样抛出去
    console.error(error)
    process.exit(1)
  }
}

const pkgDir = resolve(dirname(modulePath), '..')
console.log('原生模块还是 Electron 的 ABI，正在换回 Node 的…')
execFileSync('npx', ['--yes', 'prebuild-install', '--force'], {
  cwd: pkgDir,
  stdio: 'inherit',
})

// 新下载的文件带着上一份的签名记录，得再补一次
execFileSync('node', [join(root, 'scripts', 'sign-native.mjs')], { stdio: 'inherit' })
console.log('已就绪')
