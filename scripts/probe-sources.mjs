#!/usr/bin/env node
/**
 * 会话源探针。
 * 对本机装的每个 agent 各读一个真实会话，打印解析结果。
 * 用途：新增适配器或对方改了落盘格式时，一条命令确认解析是否还正确。
 *
 *   node scripts/probe-sources.mjs [每个源展示的消息条数]
 */
import {
  ClaudeCodeSource,
  CodexSource,
  OpencodeSource,
  PiSource,
} from '../packages/ingest/dist/index.js'

const SHOW = Number(process.argv[2] ?? 3)
const sources = [new ClaudeCodeSource(), new CodexSource(), new PiSource(), new OpencodeSource()]

for (const source of sources) {
  const head = `── ${source.agent} `.padEnd(70, '─')
  console.log(`\n${head}`)
  console.log(`路径: ${source.rootPath}`)

  if (!source.isAvailable()) {
    console.log('状态: 未安装 / 路径不存在')
    continue
  }

  const t0 = Date.now()
  const refs = await source.discover({ limit: 5 })
  console.log(`发现: ${refs.length} 个会话源（${Date.now() - t0}ms）`)
  if (refs.length === 0) continue

  let shown = 0
  for (const ref of refs) {
    const { conversation, cursor } = await source.read(ref)
    if (!conversation) continue
    shown++
    console.log(`\n  会话 ${conversation.id}`)
    console.log(`  标题: ${conversation.title}`)
    console.log(`  目录: ${conversation.cwd ?? '(未知)'}  项目: ${conversation.project ?? '-'}`)
    console.log(`  模型: ${conversation.model ?? '-'}  消息数: ${conversation.messages.length}`)
    console.log(
      `  时间: ${new Date(conversation.startedAt).toLocaleString('zh-CN')} → ${new Date(conversation.endedAt).toLocaleString('zh-CN')}`,
    )
    console.log(`  游标: offset=${cursor?.offset}`)
    for (const m of conversation.messages.slice(0, SHOW)) {
      const text = m.text.replace(/\s+/g, ' ').slice(0, 110)
      console.log(`    [${m.role.padEnd(9)}] ${text}${m.text.length > 110 ? '…' : ''}`)
    }
    break
  }
  if (shown === 0) console.log('  （这些源里没有可用消息）')
}

console.log('\n完成。')
for (const s of sources) s.close?.()
