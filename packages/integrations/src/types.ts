/** agent 接入的类型定义 */

export type InstallTarget = 'claude-code' | 'codex' | 'opencode' | 'pi'
export type IntegrationFormat = 'json-mcpServers' | 'json-opencode' | 'toml'

export interface AgentIntegration {
  id: InstallTarget
  configPath: string
  format: IntegrationFormat
}

export interface IntegrationStatus {
  agent: InstallTarget
  configPath: string
  installed: boolean
  agentPresent: boolean
}

export interface IntegrationOptions {
  readOnly?: boolean
  /** 测试和便携安装可覆盖 MCP server 入口。 */
  serverEntry?: { command: string; args: string[]; env?: Record<string, string> }
  /** 测试可覆盖各 agent 配置位置，避免触碰真实用户配置。 */
  integrations?: AgentIntegration[]
  /** 是否同时写入 skill 文件，默认写入。测试里关掉以免碰真实用户目录。 */
  skill?: boolean
}
