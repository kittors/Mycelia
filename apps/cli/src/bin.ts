#!/usr/bin/env node
import { MemoryService } from '@mycelia/core'
import { Command } from 'commander'
import { installCommand, uninstallCommand } from './commands/install.js'
import {
  addCommand,
  listCommand,
  removeCommand,
  reviewCommand,
  searchCommand,
  showCommand,
} from './commands/memory/index.js'
import {
  configCommand,
  daemonCommand,
  digestCommand,
  doctorCommand,
  graphCommand,
  reindexCommand,
  statsCommand,
  syncCommand,
} from './commands/system/index.js'
import { ensureUnlocked, vaultCommand } from './commands/vault.js'
import { accent, c, fail, line } from './ui.js'

const VERSION = '0.1.0'

const BANNER = `${accent('  ⬡ Mycelia')} ${c.gray(`v${VERSION}`)}
${c.gray('  连接所有 agent 知识的地下菌丝网络')}`

const program = new Command()

program
  .name('myc')
  .description(`${BANNER}\n\n  为 Claude Code / Codex / opencode / pi 提供跨会话长期记忆。`)
  .version(VERSION, '-v, --version', '显示版本')
  .helpOption('-h, --help', '显示帮助')
  .option('--db <path>', '指定数据库文件')
  .option('--unlock [passphrase]', '本次命令临时解锁保险箱')

/** 惰性打开服务：像 install / help 这类命令不需要碰数据库 */
let service: MemoryService | null = null
function getService(): MemoryService {
  if (!service) {
    const opts = program.opts()
    service = MemoryService.open({ dbPath: opts.db })
  }
  return service
}

async function withService<T>(fn: (s: MemoryService) => Promise<T> | T): Promise<void> {
  const s = getService()
  const unlock = program.opts().unlock
  if (unlock !== undefined) {
    const ok = await ensureUnlocked(s, typeof unlock === 'string' ? unlock : undefined)
    if (!ok) {
      process.exitCode = 1
      return
    }
  }
  try {
    await fn(s)
  } catch (e) {
    fail(String(e instanceof Error ? e.message : e))
    if (process.env.MYCELIA_LOG_LEVEL === 'debug' && e instanceof Error) {
      line(c.gray(e.stack ?? ''))
    }
    process.exitCode = 1
  }
}

// ───────────────────────────── 检索与浏览 ─────────────────────────────

program
  .command('search <query...>')
  .alias('s')
  .description('检索记忆（语义 + 关键词 + 图谱扩散）')
  .option('-n, --limit <n>', '返回条数', '8')
  .option('-k, --kind <kind...>', '限定类型')
  .option('-t, --tag <tag...>', '限定标签')
  .option('-p, --project <name>', '限定项目')
  .option('-d, --days <n>', '只看最近 N 天')
  .option('--secrets', '包含加密记忆（需解锁）')
  .option('--pending', '包含待确认记忆')
  .option('--full', '显示完整内容')
  .option('--json', '输出 JSON')
  .action((query: string[], opts) => withService((s) => searchCommand(s, query.join(' '), opts)))

program
  .command('list')
  .alias('ls')
  .description('列出记忆')
  .option('-k, --kind <kind...>', '限定类型')
  .option('-t, --tag <tag...>', '限定标签')
  .option('-p, --project <name>', '限定项目')
  .option('-n, --limit <n>', '条数', '30')
  .option('--pending', '包含待确认')
  .option('--archived', '包含已归档')
  .option('--sort <field>', '排序：updated / created / importance / accessed', 'updated')
  .option('--json', '输出 JSON')
  .action((opts) => withService((s) => listCommand(s, opts)))

program
  .command('show <id>')
  .description('查看单条记忆详情与其关联')
  .option('--json', '输出 JSON')
  .action((id: string, opts) => withService((s) => showCommand(s, id, opts)))

// ───────────────────────────── 写入与整理 ─────────────────────────────

program
  .command('add')
  .description('手动添加一条记忆')
  .option('-T, --title <text>', '标题')
  .option('-C, --content <text>', '内容')
  .option('-k, --kind <kind>', '类型', 'fact')
  .option('-t, --tag <tag...>', '标签')
  .option('-s, --sensitivity <level>', 'public / private / secret', 'private')
  .option('-i, --importance <n>', '重要度 0~1', '0.7')
  .option('-p, --project <name>', '归属项目')
  .option('--pin', '置顶')
  .action((opts) => withService((s) => addCommand(s, opts)))

program
  .command('rm <ids...>')
  .description('删除记忆')
  .option('-y, --yes', '不询问直接删')
  .action((ids: string[], opts) => withService((s) => removeCommand(s, ids, opts)))

program
  .command('review')
  .description('逐条确认自动提取的待定记忆')
  .option('-n, --limit <n>', '本次审阅条数', '20')
  .action((opts) => withService((s) => reviewCommand(s, opts)))

// ───────────────────────────── 同步与后台 ─────────────────────────────

program
  .command('sync')
  .description('扫描各 agent 的会话并提取记忆')
  .option('-a, --agent <agent...>', '只同步指定 agent')
  .option('-f, --force', '忽略断点，重新读取全部会话')
  .option('-m, --max <n>', '本轮最多处理的会话数')
  .option('-q, --quiet', '不显示进度条')
  .action((opts) => withService((s) => syncCommand(s, opts)))

program
  .command('daemon')
  .description('常驻后台，自动监听并提取记忆')
  .action(() => withService((s) => daemonCommand(s)))

program
  .command('serve')
  .description('以 MCP server 模式运行（供 agent 通过 stdio 调用）')
  .option('--read-only', '禁止 agent 写入记忆')
  .option('--expose-secrets', '允许返回加密记忆明文')
  .action(async (opts) => {
    // 动态导入：MCP SDK 较重，其他命令不该为它付启动成本
    const { startStdioServer } = await import('@mycelia/mcp-server')
    await startStdioServer({
      service: getService(),
      allowWrite: !opts.readOnly,
      exposeSecrets: opts.exposeSecrets,
      clientName: 'myc-serve',
    })
  })

// ───────────────────────────── 图谱与汇总 ─────────────────────────────

program
  .command('graph')
  .description('查看知识图谱结构')
  .option('--rebuild', '重建全部关联边')
  .option('-t, --tag <tag...>', '只看某些标签')
  .option('-p, --project <name>', '只看某个项目')
  .option('--pending', '包含待确认记忆')
  .option('--json', '导出 JSON（可喂给可视化工具）')
  .action((opts) => withService((s) => graphCommand(s, opts)))

program
  .command('digest')
  .description('生成工作纪要：这段时间干了什么')
  .option('-d, --days <n>', '回溯天数', '7')
  .action((opts) => withService((s) => digestCommand(s, opts)))

program
  .command('stats')
  .description('记忆库统计')
  .action(() => withService((s) => statsCommand(s)))

// ───────────────────────────── 系统 ─────────────────────────────

program
  .command('doctor')
  .description('体检：检查 agent 接入、模型配置、数据完整性')
  .action(() => withService((s) => doctorCommand(s)))

program
  .command('reindex')
  .description('补齐缺失向量并重建图谱')
  .action(() => withService((s) => reindexCommand(s)))

program
  .command('vault [action]')
  .description('保险箱：status / init / unlock / lock / passwd / list')
  .option('--passphrase <text>', '直接传口令（脚本用，注意会进 shell 历史）')
  .action((action: string | undefined, opts) => withService((s) => vaultCommand(s, action, opts)))

program
  .command('config [key] [value]')
  .description('查看或修改配置')
  .action((key: string | undefined, value: string | undefined) =>
    withService((s) => configCommand(s, key, value)),
  )

program
  .command('install [targets...]')
  .description(
    '把 Mycelia 注册为各 agent 的 MCP server（claude-code / codex / opencode / pi / all）',
  )
  .option('-y, --yes', '不逐个确认')
  .option('--read-only', '以只读模式注册')
  .action((targets: string[], opts) => installCommand(targets, opts))

program
  .command('uninstall [targets...]')
  .description('从各 agent 移除 Mycelia')
  .option('-y, --yes', '不逐个确认')
  .action((targets: string[], opts) => uninstallCommand(targets, opts))

// ───────────────────────────── 启动 ─────────────────────────────

async function main() {
  if (process.argv.length <= 2) {
    line(BANNER)
    line('')
    program.outputHelp()
    return
  }
  await program.parseAsync(process.argv)
}

main()
  .catch((e) => {
    fail(String(e instanceof Error ? e.message : e))
    process.exitCode = 1
  })
  .finally(() => {
    service?.close()
  })
