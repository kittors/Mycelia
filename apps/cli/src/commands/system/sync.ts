/**
 * 导入与守护进程。
 *
 * 注意这不是主路径 —— 记忆的正常来源是 agent 通过 MCP 主动写入。
 * 这两个命令是给「我用了半年 Claude Code，之前的东西不想丢」的用户回捞存量的。
 */

import type { MemoryService } from '@mycelia/core'
import { Scheduler } from '@mycelia/daemon'
import { AGENT_LABELS, DAY_MS, dataDir } from '@mycelia/shared'
import {
  c,
  clearProgress,
  fail,
  formatDuration,
  header,
  kv,
  line,
  progress,
  warn,
} from '../../ui.js'

export async function syncCommand(
  service: MemoryService,
  opts: { agent?: string[]; force?: boolean; max?: string; quiet?: boolean },
): Promise<void> {
  header('同步会话')

  const { ingest, pipeline } = await service.sync({
    agents: opts.agent as never,
    force: opts.force,
    maxConversations: opts.max ? Number(opts.max) : undefined,
    onProgress: opts.quiet ? undefined : (done, total, cur) => progress(done, total, cur),
  })
  clearProgress()

  kv('扫描源', `${ingest.scannedSources} 个（${ingest.changedSources} 个有更新）`)
  kv('新会话', `${ingest.conversations.length} 个`)
  if (Object.keys(ingest.byAgent).length > 0) {
    kv(
      '按来源',
      Object.entries(ingest.byAgent)
        .map(([a, n]) => `${AGENT_LABELS[a as keyof typeof AGENT_LABELS] ?? a} ${n}`)
        .join(' · '),
    )
  }
  kv(
    '已提取',
    `${pipeline.processedConversations} 个会话，跳过 ${pipeline.skippedConversations} 个`,
  )
  kv('新增记忆', `${c.green(String(pipeline.createdMemories))} 条`)
  if (pipeline.pendingMemories > 0) {
    kv(
      '待确认',
      `${c.yellow(String(pipeline.pendingMemories))} 条 ${c.gray('（跑 myc review 逐条确认）')}`,
    )
  }
  if (pipeline.mergedMemories > 0) kv('合并重复', `${pipeline.mergedMemories} 条`)
  kv('图谱边', `${pipeline.edgesCreated} 条`)
  if (pipeline.llmCalls > 0) {
    kv('LLM', `${pipeline.llmCalls} 次调用，${pipeline.tokensUsed.toLocaleString()} tokens`)
  } else {
    kv('提取方式', c.yellow('规则模式（未配置 LLM，质量有限）'))
  }
  kv('耗时', formatDuration(pipeline.durationMs))

  if (pipeline.errors.length > 0) {
    line('')
    warn(`${pipeline.errors.length} 个会话处理失败：`)
    for (const e of pipeline.errors.slice(0, 5)) line(c.gray(`    ${e}`))
  }
  line('')
}

export async function daemonCommand(service: MemoryService): Promise<void> {
  header('Mycelia 守护进程')
  const scheduler = new Scheduler(service, {
    onStart: () => line(c.gray(`${new Date().toLocaleTimeString('zh-CN')} 开始同步…`)),
    onComplete: (s) => {
      if (s.skippedByLease) return
      line(
        `${new Date().toLocaleTimeString('zh-CN')} ${c.green('完成')} ${c.gray(`会话 ${s.conversations} · 新增 ${s.created} · 待确认 ${s.pending} · ${formatDuration(s.durationMs)}`)}`,
      )
    },
    onError: (e) => fail(e.message),
  })

  scheduler.start()
  const cfg = service.config
  kv('轮询间隔', `${Math.round(cfg.ingest.pollIntervalMs / 1000)} 秒`)
  kv('数据目录', dataDir())
  line(c.gray('\n  Ctrl+C 退出\n'))

  // 每天跑一次维护
  const maintenanceTimer = setInterval(() => void scheduler.maintenance(), DAY_MS)
  maintenanceTimer.unref?.()

  await new Promise<void>((resolve) => {
    const stop = async () => {
      line(c.gray('\n正在停止…'))
      clearInterval(maintenanceTimer)
      await scheduler.stop()
      resolve()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
}
