/**
 * 准入把关的实机验证。
 *
 * 用真实模型跑一遍：有价值的内容该进，噪音该被拦。
 * 这条链路的判断是主观的，单测锁不住，只能靠实跑观察。
 *
 *   MYCELIA_HOME=/tmp/mycelia-probe node scripts/probe-capture.mjs
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.MYCELIA_HOME ??= mkdtempSync(join(tmpdir(), 'mycelia-probe-'))

const { MemoryService } = await import('../packages/core/dist/index.js')

const CASES = [
  {
    label: '具体环境事实',
    expect: 'accept',
    candidate: {
      title: 'server-hk-01 的 SSH 登录方式',
      content:
        '香港服务器 server-hk-01（43.128.x.x）用 ~/.ssh/hk01_ed25519 私钥登录，端口 2222，用户名 deploy。禁用了密码登录。',
      kind: 'fact',
    },
  },
  {
    label: '用户偏好',
    expect: 'accept',
    candidate: {
      title: '提交信息使用 conventional commits',
      content:
        '这个仓库的提交信息必须遵循 conventional commits 规范，type 只允许 feat/fix/docs/refactor/test/chore，scope 用包名。',
      kind: 'preference',
    },
  },
  {
    label: '排障根因',
    expect: 'accept',
    candidate: {
      title: 'better-sqlite3 在 Electron 下 ABI 不匹配',
      content:
        'Electron 与 Node 的 NODE_MODULE_VERSION 不同，better-sqlite3 编译产物不能共用。跑测试前要 npm rebuild，开发 Electron 前要 electron-rebuild。predev 脚本已经处理了后者。',
      kind: 'issue',
    },
  },
  {
    label: '一次性任务上下文',
    expect: 'reject',
    candidate: {
      title: '当前正在修改 App.tsx',
      content: '现在正在改 App.tsx 这个文件，已经改到第 300 行左右了，等下要继续往下看。',
      kind: 'project',
    },
  },
  {
    label: '模型自己就知道的通用知识',
    expect: 'reject',
    candidate: {
      title: 'React 是什么',
      content: 'React 是 Meta 开发的前端框架，用于构建用户界面，核心概念是组件化和虚拟 DOM。',
      kind: 'learning',
    },
  },
  {
    label: '没有信息量的泛泛结论',
    expect: 'reject',
    candidate: {
      title: '要注意代码性能',
      content: '写代码的时候要注意性能问题，同时也要考虑可维护性，这两者需要平衡。',
      kind: 'insight',
    },
  },
  {
    label: '进度汇报',
    expect: 'reject',
    candidate: {
      title: '第一阶段已完成',
      content: '配置层的改造已经完成了，接下来准备做桌面端的部分。',
      kind: 'project',
    },
  },
]

const service = MemoryService.open()
console.log(`数据目录 ${process.env.MYCELIA_HOME}`)
console.log(`模型 ${service.llm.model}（${service.llm.id}，启用 ${service.llm.enabled}）`)
console.log(`嵌入 ${service.embedder.id} / ${service.embedder.kind}\n`)

let correct = 0
for (const testCase of CASES) {
  const started = Date.now()
  const { decision } = await service.capture(testCase.candidate, { captureMode: 'agent' })
  // review 与 reject 都算「没让它直接进主库」，是同一类判断
  const blocked = decision.verdict === 'review' || decision.verdict === 'reject'
  const actual = blocked ? 'reject' : decision.verdict
  const ok = actual === testCase.expect
  if (ok) correct++

  console.log(`${ok ? '✔' : '✘'} ${testCase.label}`)
  console.log(`   期望 ${testCase.expect} → 实际 ${decision.verdict}（${Date.now() - started}ms）`)
  console.log(`   理由：${decision.reason}\n`)
}

console.log(`把关准确率 ${correct}/${CASES.length}`)
console.log(
  `库中实际留存：${service.store.memories.count({ status: ['active'] })} 条 active，${service.store.memories.count({ status: ['pending'] })} 条待审`,
)
service.close()
