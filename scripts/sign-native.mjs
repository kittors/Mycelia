#!/usr/bin/env node
/**
 * 给原生模块补一个 ad-hoc 签名。
 *
 * Apple Silicon 上加载 .node 会校验签名，而重建或重新下载都盖不掉旧签名的
 * 记录 —— 内容与签名对不上，内核直接 SIGKILL。表现是进程凭空消失：
 * 没有堆栈、没有报错，Electron 那边只留一句 exited with signal SIGKILL，
 * 测试那边只说一句 'test failed'。第一次遇到能耗掉一下午。
 *
 * 每次切换 ABI（跑测试用 Node 的、跑应用用 Electron 的）都要重来一遍，
 * 所以做成脚本挂在两边的钩子上。
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages/store/package.json'))

let binary
try {
  binary = join(
    dirname(require.resolve('better-sqlite3')),
    '..',
    'build',
    'Release',
    'better_sqlite3.node',
  )
} catch {
  process.exit(0)
}
if (!existsSync(binary)) process.exit(0)

try {
  execFileSync('codesign', ['--remove-signature', binary], { stdio: 'ignore' })
} catch {
  // 本来就没签过，跳过
}
execFileSync('codesign', ['--force', '--sign', '-', binary], { stdio: 'ignore' })
