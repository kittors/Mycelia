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

/**
 * 键名的左边界。
 *
 * 不用 \b：它只认 ASCII 词边界，中文键名（密码、密钥）前后都不成立。
 */
const KEY_BOUNDARY = String.raw`(?<![A-Za-z0-9_])`

/**
 * 键名与值之间那一段。
 *
 * 允许星号（Markdown 加粗）、全角与半角冒号、等号、引号、反引号任意组合 ——
 * `**密码：** \`xxx\`` 和 `password=xxx` 要走同一条规则。
 */
const SEPARATOR = String.raw`\s*\**\s*[=:：]?\s*\**\s*['"\`「]?`

/** 供检测与脱敏复用 —— 检测和保管必须依据同一套规则，否则会出现
 * 「检测说有密钥、保管却没换掉」这种最糟的情况 */
export const SECRET_RULES: Rule[] = [
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
  /**
   * 显式的赋值语句：password = "xxx"、密码：xxx、**Token：** `xxx`
   *
   * 键名和值之间不一定是干净的冒号。技术笔记基本都是 Markdown，键名常被
   * 加粗成 `**密码：**`，值常被围进反引号 —— 中间就多出了星号、空格、
   * 引号好几层装饰。规则只认「冒号后面紧跟着值」的话，这类写法全部漏掉，
   * 而它恰恰是最常见的一种。
   *
   * 另外这里不能用 \b 开头：\b 的定义是 \w 与非 \w 的交界，而 \w 只含
   * ASCII —— 「密码」两个字前后都不是 \w，边界根本不成立。改用负向后顾，
   * 只排除掉紧贴着英文数字的情况（那多半是某个更长单词的一部分）。
   */
  {
    kind: 'password',
    re: new RegExp(
      `${KEY_BOUNDARY}(?:password|passwd|pwd|密码|口令|登录密码)${SEPARATOR}([^\\s'"\`，,;|）)】\\]>*]{6,})`,
      'gi',
    ),
    confidence: 0.7,
  },
  {
    kind: 'token',
    re: new RegExp(
      `${KEY_BOUNDARY}(?:api[_-]?key|apikey|secret|token|access[_-]?key|密钥|令牌)${SEPARATOR}([A-Za-z0-9\\-_./+=]{16,})`,
      'gi',
    ),
    confidence: 0.75,
  },
  // sshpass 的命令行口令。不含 `ssh -i`：那后面跟的是私钥的路径，
  // 路径本身不是秘密，把它换成记号只会让命令没法照抄
  { kind: 'ssh', re: /\bsshpass\s+-p\s*(\S+)/g, confidence: 0.9 },
  /**
   * 环境变量形式：XXX_SECRET=、XXX_TOKEN=、XXX_PASSWORD=
   *
   * 变量名本身就声明了值的性质，可信度比裸的赋值语句高 —— 没人会把
   * 一个无关紧要的值命名成 SECRET。
   */
  {
    kind: 'token',
    re: /\b[A-Z][A-Z0-9_]*_(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL)\s*=\s*['"]?([^\s'"`,;]{8,})/g,
    confidence: 0.9,
  },
]

/** 明显是占位符的值，命中后直接放行，减少噪音 */
const PLACEHOLDER =
  /^(?:x{3,}|\*{3,}|<[^>]*>?|\$\{[^}]+\}|your[_-]?\w+|placeholder|example|changeme|todo|redacted|null|none|test)$/i

/**
 * 判断一个值是不是占位符。
 *
 * 先把包裹符号剥掉再比对：规则的字符集会把 `<`、引号这类边界字符
 * 一起圈进值里，剩下的 `<your-password` 就不再长得像占位符了，
 * 于是文档里的示例被当成真密码换掉。
 */
export function isPlaceholderValue(value: string): boolean {
  const bare = value
    .trim()
    .replace(/^[<'"`「（([{]+/, '')
    .replace(/[>'"`」）)\]}]+$/, '')
  return PLACEHOLDER.test(value.trim()) || PLACEHOLDER.test(bare)
}

export function detectSecrets(text: string): SecretMatch[] {
  const out: SecretMatch[] = []
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null = rule.re.exec(text)
    while (m !== null) {
      const captured = m[1] ?? m[0]
      if (!isPlaceholderValue(captured)) {
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
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0
    result = result.replace(rule.re, (full, captured?: string) => {
      const target = captured ?? full
      if (isPlaceholderValue(String(target))) return full
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
