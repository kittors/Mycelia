import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  type AgentIntegration,
  installIntegration,
  integrationStatus,
  uninstallIntegration,
} from './index.js'

function fixture(): { root: string; integrations: AgentIntegration[] } {
  const root = mkdtempSync(join(tmpdir(), 'mycelia-integrations-'))
  const integrations: AgentIntegration[] = [
    { id: 'claude-code', configPath: join(root, 'claude', 'mcp.json'), format: 'json-mcpServers' },
    { id: 'codex', configPath: join(root, 'codex', 'config.toml'), format: 'toml' },
    {
      id: 'opencode',
      configPath: join(root, 'opencode', 'opencode.json'),
      format: 'json-opencode',
    },
    { id: 'pi', configPath: join(root, 'pi', 'mcp.json'), format: 'json-mcpServers' },
  ]
  for (const item of integrations) mkdirSync(dirname(item.configPath), { recursive: true })
  return { root, integrations }
}

const entry = { command: '/usr/bin/node', args: ['/opt/mycelia/mcp.js'] }

test('为 Claude Code 与 pi 写入标准 mcpServers 配置且幂等', () => {
  const { integrations } = fixture()
  for (const agent of ['claude-code', 'pi'] as const) {
    assert.equal(
      installIntegration(agent, { skill: false, integrations, serverEntry: entry }),
      true,
    )
    assert.equal(
      installIntegration(agent, { skill: false, integrations, serverEntry: entry }),
      false,
    )
    const item = integrations.find((candidate) => candidate.id === agent)!
    const root = JSON.parse(readFileSync(item.configPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
    }
    assert.deepEqual(root.mcpServers.mycelia, {
      command: entry.command,
      args: entry.args,
      env: { MYCELIA_CLIENT: agent },
    })
    assert.equal(uninstallIntegration(agent, integrations), true)
    assert.equal(uninstallIntegration(agent, integrations), false)
  }
})

test('为 opencode 写入 local MCP 数组格式与只读参数', () => {
  const { integrations } = fixture()
  assert.equal(
    installIntegration('opencode', {
      skill: false,
      integrations,
      serverEntry: entry,
      readOnly: true,
    }),
    true,
  )
  const item = integrations.find((candidate) => candidate.id === 'opencode')!
  const root = JSON.parse(readFileSync(item.configPath, 'utf8')) as {
    mcp: Record<
      string,
      { type: string; command: string[]; enabled: boolean; environment: Record<string, string> }
    >
  }
  assert.deepEqual(root.mcp.mycelia, {
    type: 'local',
    command: [entry.command, ...entry.args, '--read-only'],
    enabled: true,
    environment: { MYCELIA_CLIENT: 'opencode' },
  })
})

test('Codex TOML 更新只替换 Mycelia 表并保留注释和其他 server', () => {
  const { integrations } = fixture()
  const item = integrations.find((candidate) => candidate.id === 'codex')!
  writeFileSync(
    item.configPath,
    '# 用户注释\nmodel = "gpt-test"\n\n[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.mycelia]\ncommand = "old"\n\n[mcp_servers.mycelia.env]\nOLD = "1"\n',
  )
  assert.equal(
    installIntegration('codex', { skill: false, integrations, serverEntry: entry }),
    true,
  )
  const updated = readFileSync(item.configPath, 'utf8')
  assert.match(updated, /# 用户注释/)
  assert.match(updated, /\[mcp_servers\.other\]/)
  assert.equal((updated.match(/\[mcp_servers\.mycelia\]/g) ?? []).length, 1)
  assert.match(updated, /command = "\/usr\/bin\/node"/)
  assert.equal(
    installIntegration('codex', { skill: false, integrations, serverEntry: entry }),
    false,
  )
  assert.equal(uninstallIntegration('codex', integrations), true)
  const removed = readFileSync(item.configPath, 'utf8')
  assert.doesNotMatch(removed, /mcp_servers\.mycelia/)
  assert.match(removed, /mcp_servers\.other/)
})

test('状态检测解析结构，不把普通文本中的 mycelia 当作已安装', () => {
  const { integrations } = fixture()
  const claude = integrations.find((candidate) => candidate.id === 'claude-code')!
  writeFileSync(claude.configPath, JSON.stringify({ note: 'mycelia' }))
  assert.equal(
    integrationStatus(integrations).find((item) => item.agent === 'claude-code')?.installed,
    false,
  )
  installIntegration('claude-code', { skill: false, integrations, serverEntry: entry })
  assert.equal(
    integrationStatus(integrations).find((item) => item.agent === 'claude-code')?.installed,
    true,
  )
})
