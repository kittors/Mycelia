/**
 * 凭据探测器。
 *
 * 这是安全链路的第一道闸门：会话原文里一旦出现密钥形态的字符串，
 * 由它决定该条记忆是否强制走 secret 通道（加密 + 默认不外泄）。
 * 宁可误报 —— 误报的代价只是用户多点一次「其实不敏感」。
 */

export type SecretKind =
  | 'private-key'
  | 'ssh'
  | 'api-key'
  | 'token'
  | 'password'
  | 'connection-string'
  | 'aws'
  | 'jwt'
  | 'certificate'

export interface SecretMatch {
  kind: SecretKind
  /** 命中的片段（已截断，不保留完整密钥） */
  preview: string
  index: number
  /** 0~1，命中强度。私钥块是 1.0，弱口令模式可能只有 0.5 */
  confidence: number
}

interface Rule {
  kind: SecretKind
  re: RegExp
  confidence: number
}

const RULES: Rule[] = [
  // 私钥块 —— 最强信号，几乎不可能误报
  {
    kind: 'private-key',
    re: /-----BEGIN\s+(RSA|OPENSSH|DSA|EC|PGP|ENCRYPTED)?\s*PRIVATE KEY-----/g,
    confidence: 1,
  },
  { kind: 'certificate', re: /-----BEGIN CERTIFICATE-----/g, confidence: 0.8 },
  // OpenSSH 公钥/私钥体
  { kind: 'ssh', re: /\bssh-(rsa|ed25519|dss)\s+AAAA[0-9A-Za-z+/]{20,}/g, confidence: 0.9 },
  // 各家 API Key 的固定前缀
  { kind: 'api-key', re: /\bsk-ant-[A-Za-z0-9\-_]{20,}/g, confidence: 1 },
  { kind: 'api-key', re: /\bsk-[A-Za-z0-9]{32,}/g, confidence: 0.95 },
  { kind: 'api-key', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, confidence: 1 },
  { kind: 'api-key', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, confidence: 0.95 },
  { kind: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g, confidence: 1 },
  {
    kind: 'aws',
    re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/gi,
    confidence: 1,
  },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    confidence: 0.85,
  },
  // 数据库 / 消息队列连接串里内嵌的账密
  {
    kind: 'connection-string',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|rediss):\/\/[^\s:@/]+:[^\s@/]+@/gi,
    confidence: 0.95,
  },
  // 显式的赋值语句：password = "xxx"、token: 'xxx'
  {
    kind: 'password',
    re: /\b(?:password|passwd|pwd|密码|口令)\s*[=:：]\s*['"]?([^\s'"，,;]{6,})/gi,
    confidence: 0.7,
  },
  {
    kind: 'token',
    re: /\b(?:api[_-]?key|apikey|secret|token|access[_-]?key|密钥)\s*[=:：]\s*['"]?([A-Za-z0-9\-_./+=]{16,})/gi,
    confidence: 0.75,
  },
  // sshpass / ssh -i 之类的命令行
  { kind: 'ssh', re: /\bsshpass\s+-p\s*\S+/g, confidence: 0.9 },
]

/** 明显是占位符的值，命中后直接放行，减少噪音 */
const PLACEHOLDER =
  /^(?:x{3,}|\*{3,}|<[^>]+>|\$\{[^}]+\}|your[_-]?\w+|placeholder|example|changeme|todo|redacted|null|none|test)$/i

export function detectSecrets(text: string): SecretMatch[] {
  const out: SecretMatch[] = []
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null = rule.re.exec(text)
    while (m !== null) {
      const captured = m[1] ?? m[0]
      if (!PLACEHOLDER.test(captured.trim())) {
        out.push({
          kind: rule.kind,
          preview: maskPreview(m[0]),
          index: m.index,
          confidence: rule.confidence,
        })
      }
      m = rule.re.exec(text)
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

export function hasSecrets(text: string, minConfidence = 0.7): boolean {
  return detectSecrets(text).some((s) => s.confidence >= minConfidence)
}

/**
 * 把文本里的密钥替换成占位符。
 * 用于「这条记忆本身不敏感，但正文里夹带了一个 token」的情况：
 * 正文照常存 public，夹带的密钥被抹掉。
 */
export function redact(text: string): { text: string; matches: SecretMatch[] } {
  const matches = detectSecrets(text)
  if (matches.length === 0) return { text, matches }

  let result = text
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    result = result.replace(rule.re, (full, captured?: string) => {
      const target = captured ?? full
      if (PLACEHOLDER.test(String(target).trim())) return full
      if (captured) return full.replace(captured, `[已隐去:${rule.kind}]`)
      return `[已隐去:${rule.kind}]`
    })
  }
  return { text: result, matches }
}

/** 只留头尾各 4 个字符，中间打码 */
function maskPreview(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  if (one.length <= 12) return `${one.slice(0, 2)}****`
  return `${one.slice(0, 6)}****${one.slice(-4)}`
}

/** 供 UI 展示的中文名 */
export const SECRET_KIND_LABELS: Record<SecretKind, string> = {
  'private-key': '私钥',
  ssh: 'SSH 凭据',
  'api-key': 'API 密钥',
  token: '访问令牌',
  password: '密码',
  'connection-string': '数据库连接串',
  aws: 'AWS 凭据',
  jwt: 'JWT',
  certificate: '证书',
}
