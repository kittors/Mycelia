/**
 * Skill 安装。
 *
 * MCP 让 agent **能**用记忆库，skill 让它**记得**用。
 *
 * 这个区别很关键：光挂上 MCP，工具描述只在 agent 决定要用工具时才被认真读一遍，
 * 结果就是它答完了才想起「我好像有个记忆库」。skill 是常驻的行为约定，
 * 描述里写清触发时机，agent 在读到用户消息的那一刻就知道该先查一次。
 *
 * 不是所有 agent 都有 skill 机制。没有的（比如 Codex）只装 MCP，
 * 这里如实返回 unsupported，而不是假装装好了。
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'

export type SkillTarget = 'claude-code' | 'opencode' | 'pi'

export interface SkillStatus {
  agent: string
  supported: boolean
  installed: boolean
  path: string | null
}

const SKILL_NAME = 'mycelia'

/** 各 agent 的 skill 存放位置。返回 null 表示该 agent 没有 skill 机制 */
export function skillPath(target: string): string | null {
  const home = homedir()
  const isWin = platform() === 'win32'
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')

  switch (target === 'claude' ? 'claude-code' : target) {
    case 'claude-code':
      return join(home, '.claude', 'skills', SKILL_NAME, 'SKILL.md')
    case 'opencode':
      return join(
        isWin ? join(appData, 'opencode') : join(xdgConfig, 'opencode'),
        'skills',
        SKILL_NAME,
        'SKILL.md',
      )
    case 'pi':
      return join(home, '.pi', 'agent', 'skills', SKILL_NAME, 'SKILL.md')
    default:
      // Codex 没有 skill 机制，只能靠 MCP 工具描述
      return null
  }
}

export function renderSkill(): string {
  return `---
name: mycelia
description: 用户的长期记忆库与本地文档库。当用户提到具体的服务器、项目、服务、工具名，或说「上次」「之前」「我们的」「我的笔记」，或要执行部署、配置、排障操作时，先用 recall 查记忆、用 search_docs 查文档。确定了长期有效的事实、决策、约定或排障根因时，用 remember 写回。
---

# Mycelia 长期记忆

用户换 agent、换模型时记忆会归零。Mycelia 是本机的持久层，把知识留在工具之外。
你接入了它，就有义务维护它。

## 先查，再答

在以下情形，**先调 \`recall\`，再组织回答**：

- 用户提到具体的服务器、项目、服务、仓库、工具名
- 用户说「上次」「之前」「我们的」「还是老样子」
- 要执行部署、配置、连接、排障类操作
- 涉及用户的偏好与既定约定（回复语言、提交规范、技术选型）

记忆库里的内容是**用户环境的事实**，优先于你的一般性推测。
查不到就如实说没有记录，不要用通用知识填补空白。

用户提到「我的笔记」「文档里写过」，或你需要引用原文时，用 \`search_docs\`。
它返回的是本地文档原文，引用时注明出处文件。

## 什么该记

用 \`remember\` 写回，判断标准只有一条：**三个月后的另一次对话里，它还有用吗？**

值得记：
- 用户环境的具体事实：服务跑在哪、端口、目录约定、依赖版本约束
- 偏好与工作约定：用中文回复、提交信息格式、代码风格倾向
- 决策及其理由：为什么选 A 不选 B
- 排障结论：现象 → 根因 → 解法
- 可复用的操作步骤

不值得记：
- 本次任务的一次性上下文（「现在在改这个函数」）
- 你自己就知道的通用知识（「React 是前端框架」）
- 没有信息量的泛泛结论（「要注意性能」）
- 进度汇报与临时状态（「已完成第一步」「当前分支有冲突」）

用户原话表达了「记住这个」的意思时，带上 \`user_requested=true\`，跳过价值把关。
其余情况让把关生效 —— 它会拦掉噪音，被拒时返回结果里有理由，
读一下再决定要不要换角度重写，**不要原样重试**。

## 写入的质量要求

- **标题**脱离上下文也能看懂：写「server-hk-01 的 SSH 登录方式」，不写「服务器登录」
- **正文**自包含：不要出现「上面提到的」「刚才那个」这类指代
- **凭据**（密码、密钥、token）必须标 \`sensitivity: secret\`，会被加密存储
- **标签**用层级形式：\`infra/ssh\`、\`dev/frontend\`

## 顺藤摸瓜

\`recall\` 命中某条记忆后，如果需要展开这个话题（比如查到服务器的登录方式，
还想知道这台机器上跑着什么），用 \`related\` 沿知识图谱走一跳。
`
}

export function installSkill(target: string): { installed: boolean; path: string | null } {
  const path = skillPath(target)
  if (!path) return { installed: false, path: null }

  // agent 自己都没装，就别在它的配置目录里凭空造文件
  const agentRoot = dirname(dirname(dirname(path)))
  if (!existsSync(agentRoot)) {
    throw new Error(`${target} 未安装或配置目录不存在：${agentRoot}`)
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, renderSkill(), { mode: 0o644 })
  return { installed: true, path }
}

export function uninstallSkill(target: string): boolean {
  const path = skillPath(target)
  if (!path || !existsSync(path)) return false
  // 连同 skill 目录一起删掉，不留空壳
  rmSync(dirname(path), { recursive: true, force: true })
  return true
}

export function skillStatus(targets: readonly string[]): SkillStatus[] {
  return targets.map((agent) => {
    const path = skillPath(agent)
    return {
      agent,
      supported: path !== null,
      installed: path !== null && existsSync(path),
      path,
    }
  })
}
