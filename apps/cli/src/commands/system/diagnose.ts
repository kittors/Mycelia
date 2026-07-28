/** 体检与统计：`myc doctor` / `myc stats` */

import type { MemoryService } from '@mycelia/core'
import { AGENT_LABELS, databasePath, dataDir } from '@mycelia/shared'
import { c, formatBytes, header, kv, line, relativeTime, success, table, warn } from '../../ui.js'
import { bar } from './helpers.js'

export async function doctorCommand(service: MemoryService): Promise<void> {
  const stats = service.stats()
  let problems = 0

  header('环境')
  kv('数据目录', dataDir())
  kv('数据库', `${databasePath()} ${c.gray(`(${formatBytes(stats.health.sizeBytes)})`)}`)
  kv('日志模式', stats.health.walMode)

  header('Agent 会话源')
  for (const a of stats.agents) {
    const label = AGENT_LABELS[a.agent as keyof typeof AGENT_LABELS] ?? a.agent
    line(
      `  ${a.available ? c.green('●') : c.gray('○')} ${label.padEnd(14)} ${a.available ? c.gray(a.path) : c.gray('未检测到')}`,
    )
  }
  if (!stats.agents.some((a) => a.available)) {
    warn('没有检测到任何 agent 的会话数据')
    problems++
  }

  header('模型')
  const embedNote =
    stats.embedder.kind === 'builtin'
      ? c.yellow('内置哈希向量 — 语义检索能力有限，建议改用本地模型或 API')
      : c.green('已就绪')
  kv('嵌入', `${stats.embedder.id} ${c.gray(`(${stats.embedder.dims} 维)`)} ${embedNote}`)
  if (stats.embedder.kind === 'builtin') problems++

  if (stats.llm.enabled) {
    process.stderr.write('  正在测试 LLM 连接…')
    const test = await service.llm.test()
    process.stderr.write(`\r${' '.repeat(30)}\r`)
    kv(
      'LLM',
      `${stats.llm.id}/${stats.llm.model} ${test.ok ? c.green(`✓ ${test.latencyMs}ms`) : c.red(`✗ ${test.message}`)}`,
    )
    if (!test.ok) problems++
  } else {
    kv('LLM', c.yellow('未配置 — 记忆提取将使用规则模式，质量显著低于 LLM 提取'))
    problems++
  }

  header('保险箱')
  if (!stats.health.vaultInitialized) {
    kv('状态', c.yellow('未初始化 — 无法保存凭据类记忆，跑 `myc vault init`'))
  } else {
    kv('状态', stats.health.vaultUnlocked ? c.green('已解锁') : c.gray('已上锁'))
    kv(
      '钥匙',
      `${service.store.vault
        .status()
        .wrappers.map((w) => w.label ?? w.type)
        .join('、')}`,
    )
  }

  header('记忆库')
  kv('记忆总数', String(stats.memories.total))
  kv('待确认', stats.memories.pending > 0 ? c.yellow(String(stats.memories.pending)) : '0')
  kv('已向量化', `${stats.memories.embedded} / ${stats.memories.total}`)
  kv('图谱', `${stats.health.edgeCount} 条边，${stats.health.entityCount} 个实体`)
  kv('会话', `${stats.conversations.processed} / ${stats.conversations.total} 已处理`)
  const lastSync = service.store.meta('lastSyncAt')
  kv('上次同步', lastSync ? relativeTime(Number(lastSync)) : c.gray('从未'))

  if (stats.memories.embedded < stats.memories.total) {
    warn(
      `有 ${stats.memories.total - stats.memories.embedded} 条记忆缺少向量，跑 \`myc reindex\` 补齐`,
    )
    problems++
  }

  line('')
  if (problems === 0) success('一切正常')
  else warn(`发现 ${problems} 个可优化项`)
  line('')
}

export function statsCommand(service: MemoryService): void {
  const stats = service.store.memories.stats()

  header(`记忆库概览 ${c.gray(`共 ${stats.total} 条`)}`)

  const kindRows = Object.entries(stats.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => [k, String(n), bar(n, stats.total)])
  table(kindRows, { head: ['类型', '数量', ''] })

  header('项目分布')
  const projectRows = Object.entries(stats.byProject)
    .slice(0, 12)
    .map(([k, n]) => [k, String(n), bar(n, stats.total)])
  table(projectRows)

  header('来源分布')
  const agentRows = Object.entries(stats.byAgent).map(([k, n]) => [
    AGENT_LABELS[k as keyof typeof AGENT_LABELS] ?? k,
    String(n),
    bar(n, stats.total),
  ])
  table(agentRows)

  header('热门标签')
  const tags = service.store.tags.usage().slice(0, 15)
  table(tags.map((t) => [t.tag, String(t.count), bar(t.count, tags[0]?.count ?? 1)]))
  line('')
}
