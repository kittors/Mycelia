#!/usr/bin/env node
/**
 * 把版本号写进 package.json。
 *
 * 版本号以 git tag 为准，而不是靠人记得改 package.json ——
 * 那件事迟早会忘，然后发出去的 v0.3.0 里装着 0.1.0 的应用。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`用法：set-version.mjs <版本号>，收到的是 ${version ?? '(空)'}`)
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

for (const rel of ['package.json', 'apps/desktop/package.json']) {
  const path = join(root, rel)
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  pkg.version = version
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`${rel} → ${version}`)
}
