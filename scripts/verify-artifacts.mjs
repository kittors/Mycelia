#!/usr/bin/env node
/**
 * 检查打包产物：文件在不在、名字对不对。
 *
 * 存在的意义是挡住那类「构建绿了但产物是错的」的问题 —— electron-builder
 * 拿不到 productName 时会退回 package.json 的 name，于是发出去的东西
 * 叫 @mycelia/desktop 甚至 Electron。这种错误不会让构建失败，
 * 只会让用户下载到一个名字不对的应用。
 */

import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'apps/desktop/release')
const NAME = 'Mycelia'
/** 低于这个大小基本可以断定是个空壳：Electron 运行时本身就有一百多兆 */
const MIN_BYTES = 40 * 1024 * 1024

const PACKAGE_EXT = /\.(dmg|zip|exe|AppImage|deb|rpm)$/

let files
try {
  files = readdirSync(releaseDir)
} catch {
  console.error(`::error::找不到产物目录 ${releaseDir}`)
  process.exit(1)
}

const packages = files.filter((f) => PACKAGE_EXT.test(f))
if (packages.length === 0) {
  console.error('::error::产物目录里一个安装包都没有')
  console.error(`目录内容：${files.join(', ') || '(空)'}`)
  process.exit(1)
}

const problems = []
for (const file of packages) {
  // deb/rpm 的命名规范是小写，其余产物应当带上产品名
  const named = file.toLowerCase().startsWith(NAME.toLowerCase())
  if (!named) problems.push(`${file}：文件名没有以 ${NAME} 开头`)

  const { size } = statSync(join(releaseDir, file))
  if (size < MIN_BYTES) {
    problems.push(`${file}：只有 ${(size / 1024 / 1024).toFixed(1)}MB，疑似空壳`)
  }
}

for (const file of packages) {
  console.log(`  ${file}  ${(statSync(join(releaseDir, file)).size / 1024 / 1024).toFixed(1)}MB`)
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`)
  process.exit(1)
}

console.log(`\n${packages.length} 个产物检查通过`)
