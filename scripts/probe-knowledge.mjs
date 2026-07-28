/**
 * 文件目录知识库的端到端验证。
 *
 * 造一批带各种结构陷阱的文档（超长代码块、表格、无标题长文），索引它们，
 * 然后检索。重点看两件事：
 *   1. 碎片化防护是否生效（代码块完整、块带得上标题路径）
 *   2. 检索能不能把正确的片段捞回来
 *
 *   node scripts/probe-knowledge.mjs
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'mycelia-kb-'))
process.env.MYCELIA_HOME = home

const docsDir = join(home, 'notes')
mkdirSync(docsDir, { recursive: true })

// ── 造文档 ──
writeFileSync(
  join(docsDir, 'deploy.md'),
  `# 部署手册

本文档说明生产环境的部署流程。

## 生产环境

生产环境跑在 server-hk-01 上，用 systemd 托管。

### 启动服务

\`\`\`bash
# 这一整段必须完整保留，不能被切开
systemctl daemon-reload
systemctl enable mycelia-api
systemctl start mycelia-api
journalctl -u mycelia-api -f --since "5 min ago"
curl -sS http://127.0.0.1:8080/healthz | jq .
\`\`\`

### 回滚

改完配置之后需要重启才能生效，否则旧连接会继续用缓存里的配置。
回滚时把 symlink 指回上一个版本目录，再执行一次上面的启动流程。

## 端口约定

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| api | 8080 | 对外 HTTP |
| worker | 8081 | 内部队列 |
| metrics | 9100 | Prometheus 抓取 |
`,
)

writeFileSync(
  join(docsDir, 'decisions.md'),
  `# 技术选型记录

## 为什么用 SQLite 而不是 Postgres

这是个本地优先的桌面应用，用户不该为了记笔记先装一个数据库。
SQLite 的 WAL 模式已经能让三个进程并发读写同一个文件，够用了。

## 为什么不用 sqlite-vec

原生扩展会给三平台 Electron 打包带来编译与签名负担。
十万条以内的向量做暴力点积扫描不到 50 毫秒，还没到需要 HNSW 的量级。
`,
)

// 无标题长文：结构贫瘠，专门用来触发按句子切分的路径
const rambling = Array.from(
  { length: 40 },
  (_, i) =>
    `第 ${i + 1} 段讨论的是缓存失效问题。当写入发生时，旧的读取副本不会立即感知到变化，需要等待广播到达。这中间的窗口期就是不一致的来源。`,
).join('')
writeFileSync(join(docsDir, 'rambling.md'), rambling)

const { MemoryService } = await import('../packages/core/dist/index.js')
const service = MemoryService.open()

console.log(`数据目录 ${home}`)
console.log(`嵌入 ${service.embedder.id}`)
console.log(`模型 ${service.llm.model}（启用 ${service.llm.enabled}）\n`)

// ── 索引 ──
const source = service.addSource({ name: 'notes', path: docsDir })
const started = Date.now()
const result = await service.indexSource(source.id, {
  onProgress: ({ done, total, current }) => {
    if (current) process.stdout.write(`\r  索引中 ${done}/${total} ${current.padEnd(24)}`)
  },
})
process.stdout.write(`\r${' '.repeat(60)}\r`)

console.log(`索引完成：${result.indexedDocuments} 个文件 → ${result.createdChunks} 个片段`)
console.log(`语义增强 ${result.contextualizedChunks} 个片段，耗时 ${Date.now() - started}ms`)
if (result.errors.length) console.log(`错误：${result.errors.join('; ')}`)
console.log()

// ── 碎片化检查 ──
const allChunks = service.store.chunks.byDocument(
  service.store.documents.byRelPath(source.id, 'deploy.md').id,
)

const codeChunks = allChunks.filter((c) => c.content.includes('systemctl daemon-reload'))
const intact = codeChunks.some(
  (c) => c.content.includes('systemctl daemon-reload') && c.content.includes('curl -sS'),
)
console.log(`${intact ? '✔' : '✘'} 代码块完整：命令序列没有被切开`)

const tableChunk = allChunks.find((c) => c.content.includes('| api | 8080 |'))
const tableIntact = tableChunk?.content.includes('| metrics | 9100 |')
console.log(`${tableIntact ? '✔' : '✘'} 表格完整：三行都在同一个片段里`)

const rollback = allChunks.find((c) => c.content.includes('回滚时把 symlink'))
console.log(
  `${rollback?.heading.includes('回滚') ? '✔' : '✘'} 标题路径：「${rollback?.heading ?? '（无）'}」`,
)

const ramblingDoc = service.store.documents.byRelPath(source.id, 'rambling.md')
console.log(
  `${ramblingDoc.chunkCount > 1 ? '✔' : '✘'} 无标题长文被切成 ${ramblingDoc.chunkCount} 块\n`,
)

// ── 检索 ──
const QUERIES = [
  { text: '怎么重启服务', expect: 'deploy.md' },
  { text: '改了配置不生效怎么办', expect: 'deploy.md' },
  { text: 'worker 用哪个端口', expect: 'deploy.md' },
  { text: '为什么选择 SQLite', expect: 'decisions.md' },
  { text: '向量检索为什么不用原生扩展', expect: 'decisions.md' },
  { text: '缓存不一致的窗口期', expect: 'rambling.md' },
]

let hit = 0
for (const query of QUERIES) {
  const hits = await service.searchDocuments(query.text, { limit: 3 })
  const top = hits[0]
  const ok = top?.document.relPath === query.expect
  if (ok) hit++
  console.log(`${ok ? '✔' : '✘'} 「${query.text}」`)
  console.log(
    `   → ${top ? `${top.document.relPath}${top.heading ? ` › ${top.heading}` : ''}（${top.score.toFixed(3)}）` : '无结果'}`,
  )
  if (top) console.log(`   ${top.content.slice(0, 88).replace(/\n/g, ' ')}…`)
}

console.log(`\n检索命中 ${hit}/${QUERIES.length}`)
service.close()
