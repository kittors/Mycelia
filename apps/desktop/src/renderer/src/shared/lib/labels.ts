/** 领域枚举到中文标签与颜色的映射。集中在这里，避免各视图各写一份 */

export const KIND_LABELS: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  decision: '决策',
  howto: '操作',
  credential: '凭据',
  project: '项目',
  learning: '学习',
  issue: '排障',
  insight: '洞察',
  entity: '实体',
}

/** 颜色取自 tokens.css 的 --kind-* 变量，随主题自动切换 */
export function kindColor(kind: string): string {
  return `var(--kind-${kind in KIND_LABELS ? kind : 'entity'})`
}

export const SENSITIVITY_LABELS: Record<string, string> = {
  public: '公开',
  private: '私有',
  secret: '机密',
}

export const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  pi: 'pi',
  manual: '手动写入',
  mcp: 'MCP',
  unknown: '未知来源',
}

export function agentName(agent: string): string {
  return AGENT_LABELS[agent] ?? agent
}

export const CAPTURE_LABELS: Record<string, string> = {
  agent: 'Agent 写入',
  manual: '手动写入',
  import: '历史导入',
  rule: '规则提取',
}

export const EDGE_LABELS: Record<string, string> = {
  semantic: '语义相似',
  entity: '共享实体',
  tag: '共享标签',
  session: '同次会话',
  project: '同一项目',
  derives: '推导',
  supersedes: '取代',
  contradicts: '冲突',
  manual: '手动关联',
}

/** 图谱里默认展示的边类型。session/project 太密，默认关掉 */
export const DEFAULT_EDGE_KINDS = [
  'semantic',
  'entity',
  'tag',
  'derives',
  'supersedes',
  'contradicts',
  'manual',
] as const
