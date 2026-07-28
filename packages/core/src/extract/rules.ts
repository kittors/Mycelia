import { detectSecrets } from '@mycelia/crypto'
import type { Conversation, MemoryKind, Sensitivity } from '@mycelia/shared'
import { clamp, truncate } from '@mycelia/shared'
import type { ExtractedMemory } from './types.js'

/**
 * 规则提取器 —— 没配 LLM 时的降级方案。
 *
 * 说清楚它的定位：它抓不到「为什么这么设计」这种需要理解力的内容，
 * 只能捞取有明显语言标记的信息。质量远不如 LLM，但它保证了
 * 「装上就能用、完全离线、零成本」这条底线。
 *
 * 桌面端会把规则提取的记忆标为低置信度，推到待确认队列里让用户过一遍。
 */

interface Pattern {
  re: RegExp
  kind: MemoryKind
  confidence: number
  importance: number
  tags: string[]
}

/** 用户明确表达「要记住」的语言标记 —— 这类信号最可靠 */
const DIRECTIVE_PATTERNS: Pattern[] = [
  {
    re: /(?:记住|请记住|要记得|以后都?|从今以后|下次|每次都?|一定要|务必|必须)\s*[：:，,]?\s*(.{6,200})/g,
    kind: 'preference',
    confidence: 0.72,
    importance: 0.8,
    tags: ['user/preference'],
  },
  {
    re: /(?:不要|别|禁止|严禁|不准|不能)\s*(.{6,200})/g,
    kind: 'preference',
    confidence: 0.65,
    importance: 0.75,
    tags: ['user/preference'],
  },
  {
    re: /(?:我(?:们)?(?:的)?习惯|我(?:们)?(?:都|一般|通常)(?:是|用|会))\s*(.{6,200})/g,
    kind: 'preference',
    confidence: 0.6,
    importance: 0.6,
    tags: ['user/preference'],
  },
  {
    re: /(?:原因是|因为|之所以.{2,20}是因为|理由是)\s*(.{10,200})/g,
    kind: 'decision',
    confidence: 0.5,
    importance: 0.55,
    tags: ['dev/decision'],
  },
  {
    re: /(?:问题(?:出)?在|根因是|原来是|罪魁祸首是|坑在)\s*(.{6,200})/g,
    kind: 'issue',
    confidence: 0.6,
    importance: 0.65,
    tags: ['dev/troubleshooting'],
  },
  {
    re: /(?:学到了|明白了|原来|涨知识|第一次知道)\s*(.{8,200})/g,
    kind: 'learning',
    confidence: 0.5,
    importance: 0.5,
    tags: ['learning'],
  },
]

/** 值得记住的命令行 —— 部署、迁移、构建这类不常敲又容易忘的 */
const NOTEWORTHY_COMMAND =
  /\b((?:docker(?:\s+compose)?|kubectl|systemctl|pm2|ssh|scp|rsync|pnpm|npm|yarn|make|cargo|go|python3?|uv|psql|mysql|redis-cli|nginx|certbot)\s+[^\n`'"]{6,160})/g

/**
 * 判断一条用户消息是不是「任务指令书」而非日常对话。
 *
 * 实测发现的头号噪音源：用户经常粘贴大段结构化 prompt（`# Task:` / `## Goal`
 * 带 markdown 标题、代码块、验收标准）。这类文本里满是「必须」「不要」，
 * 正则一抓一大把，但它们是**这一次任务的要求**，不是用户的长期偏好。
 * 把它们当偏好记下来，记忆库三天就废了。
 */
function looksLikeTaskBrief(text: string): boolean {
  if (text.length > 900) return true
  if (/^#{1,3}\s/m.test(text)) return true
  const fences = (text.match(/```/g) ?? []).length
  if (fences >= 2) return true
  // 「验收标准」「Acceptance」「Deliverable」这类小标题是任务书的典型特征
  if (
    /^\s*(?:##?\s*)?(?:Goal|Task|Context|Symptom|Acceptance|Deliverable|Constraints|目标|任务|背景|验收|约束)\s*[:：]?\s*$/im.test(
      text,
    )
  )
    return true
  return false
}

/** 捕获到的片段是否像一句完整的话 —— 半截话做不成记忆 */
function isWellFormed(s: string): boolean {
  if (s.length < 8 || s.length > 200) return false
  // 以连词、标点、列表符号开头的多半是从句子中间截出来的
  if (/^[，,。、；;：:）)\]】>|·—-]/.test(s)) return false
  // 含有大量特殊符号的通常是代码片段或表格行
  const symbolRatio = (s.match(/[|`{}<>[\]$#*_~]/g) ?? []).length / s.length
  if (symbolRatio > 0.08) return false
  return true
}

export function extractByRules(conv: Conversation): ExtractedMemory[] {
  const out: ExtractedMemory[] = []
  const seen = new Set<string>()

  const push = (m: ExtractedMemory) => {
    const key = m.title.slice(0, 40)
    if (seen.has(key)) return
    seen.add(key)
    out.push(m)
  }

  for (const msg of conv.messages) {
    // 只从用户消息里提指令类记忆：AI 说「记住」是在复述，不是用户的要求
    if (msg.role !== 'user') continue
    // 任务指令书里的「必须/不要」属于本次任务，不是长期偏好
    if (looksLikeTaskBrief(msg.text)) continue
    const text = msg.text

    for (const p of DIRECTIVE_PATTERNS) {
      p.re.lastIndex = 0
      let match: RegExpExecArray | null = p.re.exec(text)
      while (match !== null) {
        const captured = (match[1] ?? '').trim().replace(/\s+/g, ' ')
        if (isWellFormed(captured)) {
          const secrets = detectSecrets(captured)
          const sensitivity: Sensitivity = secrets.length > 0 ? 'secret' : 'private'
          push({
            kind: secrets.length > 0 ? 'credential' : p.kind,
            title: truncate(captured, 40),
            content: captured,
            tags: p.tags,
            sensitivity,
            // 规则提取一律扣分：它没有理解力，很容易断章取义
            confidence: clamp(p.confidence - 0.1),
            importance: p.importance,
            entities: [],
            sourceMessageIds: [msg.id],
          })
        }
        match = p.re.exec(text)
      }
    }
  }

  // 命令行从双方消息里找：AI 给出的部署命令同样有价值
  for (const msg of conv.messages) {
    NOTEWORTHY_COMMAND.lastIndex = 0
    let match: RegExpExecArray | null = NOTEWORTHY_COMMAND.exec(msg.text)
    while (match !== null) {
      const cmd = (match[1] ?? '').trim()
      // 过滤掉查询类命令：ls、cat、git status 这些没有记忆价值
      if (cmd.length >= 12 && !/\b(?:--help|-h|--version|status|list|ls|ps)\b\s*$/.test(cmd)) {
        push({
          kind: 'howto',
          title: truncate(cmd, 40),
          content: `命令：\`${cmd}\`${conv.project ? `\n\n项目：${conv.project}` : ''}`,
          tags: ['ops/command'],
          sensitivity: detectSecrets(cmd).length > 0 ? 'secret' : 'private',
          confidence: 0.4,
          importance: 0.4,
          entities: [],
          sourceMessageIds: [msg.id],
        })
      }
      match = NOTEWORTHY_COMMAND.exec(msg.text)
    }
  }

  // 会话本身作为一条项目活动记录 —— 「这周干了啥」全靠它
  if (conv.project && conv.messages.length >= 6) {
    const firstUser = conv.messages.find((m) => m.role === 'user')
    if (firstUser) {
      push({
        kind: 'project',
        title: truncate(`${conv.project}：${firstUser.text.replace(/\s+/g, ' ')}`, 40),
        content: `在项目 ${conv.project} 中的一次工作会话。\n\n起点需求：${truncate(firstUser.text, 300)}\n\n来源：${conv.agent}，共 ${conv.messages.length} 条消息。`,
        tags: [`project/${conv.project.toLowerCase()}`, 'activity'],
        sensitivity: 'private',
        confidence: 0.35,
        importance: 0.3,
        entities: conv.project ? [{ name: conv.project, kind: 'repo' }] : [],
        sourceMessageIds: [firstUser.id],
      })
    }
  }

  return out
}
