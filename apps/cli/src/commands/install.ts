import {
  agentIntegrations,
  type InstallTarget,
  installIntegration,
  integrationStatus,
  resolveServerEntry,
  uninstallIntegration,
} from '@mycelia/integrations'
import { AGENT_LABELS } from '@mycelia/shared'
import { c, confirm, fail, header, kv, line, success } from '../ui.js'

function selectTargets(targets: string[]): InstallTarget[] {
  const all = agentIntegrations().map((item) => item.id)
  if (targets.length === 0 || targets.includes('all')) return all
  const selected = all.filter(
    (id) => targets.includes(id) || targets.includes(id.replace('-code', '')),
  )
  if (selected.length === 0) throw new Error(`无法识别的目标。可选：${all.join(' / ')} / all`)
  return selected
}

export async function installCommand(
  targets: string[],
  opts: { yes?: boolean; readOnly?: boolean },
): Promise<void> {
  let selected: InstallTarget[]
  try {
    selected = selectTargets(targets)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  const entry = resolveServerEntry()
  header('注册 Mycelia MCP Server')
  kv('命令', `${entry.command} ${entry.args.join(' ')}`)
  if (opts.readOnly) kv('模式', c.yellow('只读（agent 不能写入记忆）'))
  line('')

  const status = integrationStatus()
  for (const agent of selected) {
    const item = status.find((candidate) => candidate.agent === agent)
    const label = AGENT_LABELS[agent]
    if (!item?.agentPresent) {
      line(`  ${c.gray('○')} ${label.padEnd(14)} ${c.gray('未安装，跳过')}`)
      continue
    }
    if (!opts.yes && !(await confirm(`写入 ${label} 的配置 ${c.gray(item.configPath)}？`, true))) {
      line(`  ${c.gray('○')} ${label.padEnd(14)} ${c.gray('已跳过')}`)
      continue
    }
    try {
      const changed = installIntegration(agent, { readOnly: opts.readOnly })
      line(
        `  ${c.green('●')} ${label.padEnd(14)} ${changed ? c.green('已注册') : c.gray('已是最新')} ${c.gray(item.configPath)}`,
      )
    } catch (error) {
      line(
        `  ${c.red('✗')} ${label.padEnd(14)} ${c.red(error instanceof Error ? error.message : String(error))}`,
      )
    }
  }

  line('')
  success('完成。重启对应的 agent 后即可使用 recall / remember 等工具。')
  line(c.gray('  验证：在 agent 里问「我的记忆库里有什么」'))
  line('')
}

export async function uninstallCommand(targets: string[], opts: { yes?: boolean }): Promise<void> {
  let selected: InstallTarget[]
  try {
    selected = selectTargets(targets)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  header('移除 Mycelia MCP Server')
  const status = integrationStatus()
  for (const agent of selected) {
    const item = status.find((candidate) => candidate.agent === agent)
    const label = AGENT_LABELS[agent]
    if (!item?.installed) {
      line(`  ${c.gray('○')} ${label.padEnd(14)} ${c.gray('本来就没有')}`)
      continue
    }
    if (!opts.yes && !(await confirm(`从 ${label} 移除？`, true))) continue
    try {
      const removed = uninstallIntegration(agent)
      line(
        `  ${removed ? c.green('●') : c.gray('○')} ${label.padEnd(14)} ${removed ? '已移除' : c.gray('本来就没有')}`,
      )
    } catch (error) {
      line(
        `  ${c.red('✗')} ${label.padEnd(14)} ${c.red(error instanceof Error ? error.message : String(error))}`,
      )
    }
  }
  line('')
}

export { integrationStatus }
