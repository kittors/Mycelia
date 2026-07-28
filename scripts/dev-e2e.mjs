#!/usr/bin/env node
/**
 * 端到端冒烟：摄取真实会话 → 提取记忆 → 建图 → 检索。
 * 默认写入临时目录，不碰用户的真实记忆库。
 *
 *   node scripts/dev-e2e.mjs [处理的会话数上限]
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = process.env.MYCELIA_HOME ?? mkdtempSync(join(tmpdir(), 'mycelia-e2e-'))
process.env.MYCELIA_HOME = home
console.log(`数据目录：${home}\n`)

const { MemoryService } = await import('../packages/core/dist/index.js')

const MAX = Number(process.argv[2] ?? 8)
const service = MemoryService.open()

console.log('── 环境 ──')
const s0 = service.stats()
for (const a of s0.agents) {
  console.log(`  ${a.agent.padEnd(12)} ${a.available ? '可用' : '未安装'}  ${a.path}`)
}
console.log(`  嵌入器 ${s0.embedder.id}（${s0.embedder.kind}，${s0.embedder.dims} 维）`)
console.log(`  LLM    ${s0.llm.enabled ? `${s0.llm.id}/${s0.llm.model}` : '未配置 → 规则提取模式'}`)

console.log('\n── 摄取 + 提取 ──')
const t0 = Date.now()
const { ingest, pipeline } = await service.sync({
  maxConversations: MAX,
  onProgress: (done, total, cur) => {
    if (total > 0)
      process.stderr.write(`\r  处理中 ${done}/${total}：${cur.slice(0, 40)}          `)
  },
})
process.stderr.write(`\r${' '.repeat(70)}\r`)

console.log(`  扫描源 ${ingest.scannedSources} 个，有更新 ${ingest.changedSources} 个`)
console.log(
  `  会话   ${ingest.conversations.length} 个（按 agent：${JSON.stringify(ingest.byAgent)}）`,
)
console.log(`  已处理 ${pipeline.processedConversations}，跳过 ${pipeline.skippedConversations}`)
console.log(
  `  记忆   新增 ${pipeline.createdMemories} / 待确认 ${pipeline.pendingMemories} / 合并 ${pipeline.mergedMemories}`,
)
console.log(`  边     ${pipeline.edgesCreated} 条`)
console.log(`  耗时   ${Date.now() - t0}ms`)
if (pipeline.errors.length) console.log(`  错误   ${pipeline.errors.slice(0, 3).join(' | ')}`)

console.log('\n── 记忆样例 ──')
const sample = service.store.memories.list({
  status: ['active', 'pending'],
  limit: 8,
  orderBy: 'importance',
})
for (const m of sample) {
  const flag = m.status === 'pending' ? '待确认' : '已生效'
  console.log(`  [${m.kind.padEnd(10)}] ${flag} ${m.sensitivity.padEnd(7)} ${m.title}`)
  console.log(
    `      标签 ${m.tags.join(', ') || '(无)'}  来源 ${m.origin.agent}/${m.origin.project ?? '-'}`,
  )
}
if (sample.length === 0)
  console.log('  （没有提取到记忆 —— 规则模式下这很常见，会话里没有明确的偏好/命令语句）')

console.log('\n── 检索 ──')
for (const q of ['部署', 'ssh 服务器', '前端']) {
  const r = await service.recall({ text: q, limit: 3, includePending: true })
  console.log(
    `  「${q}」→ ${r.hits.length} 条（向量 ${r.channels.vector} / 关键词 ${r.channels.keyword} / 图扩散 ${r.channels.graph}，${r.durationMs}ms）`,
  )
  for (const h of r.hits) {
    const m = r.memories.find((x) => x.id === h.memoryId)
    console.log(`      ${h.score.toFixed(3)}  ${m?.title ?? h.memoryId}`)
  }
}

console.log('\n── 图谱 ──')
const g = service.graph({ statuses: ['active', 'pending'] })
console.log(
  `  节点 ${g.stats.memoryCount} 记忆 + ${g.stats.entityCount} 实体，边 ${g.stats.edgeCount}，簇 ${g.stats.clusterCount}`,
)
for (const c of g.clusters.slice(0, 5)) {
  console.log(`    簇「${c.label}」${c.size} 个节点，标签：${c.topTags.slice(0, 3).join(', ')}`)
}

console.log('\n── 周报 ──')
const digest = await service.weeklyDigest()
console.log(
  digest
    .split('\n')
    .slice(0, 12)
    .map((l) => `  ${l}`)
    .join('\n'),
)

service.close()
console.log('\n完成。')
