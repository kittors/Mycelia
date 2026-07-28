import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { MyceliaStore } from './index.js'

let dir: string
let store: MyceliaStore

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'mycelia-test-'))
  store = MyceliaStore.open({ dbPath: join(dir, 'test.db'), vaultPath: join(dir, 'vault.json') })
})

after(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const origin = { agent: 'claude-code', messageIds: [] }

describe('MemoryRepo', () => {
  it('写入后能按 ID 读回', () => {
    const m = store.memories.insert({
      kind: 'fact',
      title: 'AI_Bidding 用 pnpm 管理依赖',
      content: '项目根目录有 pnpm-workspace.yaml，禁止使用 npm install。',
      tags: ['dev/tooling', 'project/ai-bidding'],
      origin,
    })
    const got = store.memories.get(m.id)
    assert.equal(got?.title, 'AI_Bidding 用 pnpm 管理依赖')
    assert.deepEqual(got?.tags, ['dev/tooling', 'project/ai-bidding'])
    assert.equal(got?.status, 'active')
  })

  it('标签会被规范化', () => {
    const m = store.memories.insert({
      kind: 'preference',
      title: '中文回复',
      content: '所有交流必须用中文。',
      tags: ['  Dev/Style  ', 'DEV/style', 'user_pref'],
      origin,
    })
    // 大小写归一 + 去重 + 下划线转连字符
    assert.deepEqual(store.memories.get(m.id)?.tags, ['dev/style', 'user-pref'])
  })

  it('中文全文检索能命中', () => {
    store.memories.insert({
      kind: 'issue',
      title: 'Electron 白屏排查',
      content: '渲染进程加载失败通常是 preload 路径写错，检查 __dirname 在 ESM 下不可用。',
      tags: ['dev/electron'],
      origin,
    })
    const hits = store.memories.fullTextSearch('preload', 10)
    assert.ok(hits.length > 0, '应能搜到 preload')
    const zh = store.memories.fullTextSearch('渲染进程', 10)
    assert.ok(zh.length > 0, '中文关键词应能命中')
  })

  it('按标签过滤支持层级前缀', () => {
    // dev 应该能匹配到 dev/tooling、dev/electron、dev/style
    const list = store.memories.list({ tags: ['dev'] })
    assert.ok(list.length >= 3, `dev 前缀应命中至少 3 条，实际 ${list.length}`)
    const exact = store.memories.list({ tags: ['dev/electron'] })
    assert.equal(exact.length, 1)
  })

  it('更新会同步全文索引', () => {
    const m = store.memories.insert({
      kind: 'howto',
      title: '临时标题',
      content: '旧内容',
      origin,
    })
    store.memories.update(m.id, { title: '部署 CliProxy', content: '用 docker compose up -d 启动' })
    const hits = store.memories.fullTextSearch('docker compose', 10)
    assert.ok(
      hits.some((h) => h.id === m.id),
      '更新后应能按新内容搜到',
    )
    const stale = store.memories.fullTextSearch('旧内容', 10)
    assert.ok(!stale.some((h) => h.id === m.id), '旧内容不应残留在索引里')
  })

  it('删除会级联清掉向量与边', () => {
    const a = store.memories.insert({ kind: 'fact', title: 'A', content: 'aaa', origin })
    const b = store.memories.insert({ kind: 'fact', title: 'B', content: 'bbb', origin })
    store.edges.upsert({ sourceId: a.id, targetId: b.id, kind: 'semantic', weight: 0.8 })
    store.vectors.upsert(store.db, a.id, 'test', new Float32Array([1, 0, 0]))

    assert.equal(store.memories.delete(a.id), true)
    assert.equal(store.memories.get(a.id), undefined)
    assert.equal(store.edges.neighbors(b.id).length, 0)
    assert.equal(store.vectors.has(a.id), false)
  })
})

describe('Vault 与 secret 记忆', () => {
  it('credential 类型强制加密，未解锁读到占位符', () => {
    store.vault.initWithPassphrase('correct horse battery staple')
    const m = store.memories.insert({
      kind: 'credential',
      title: 'server-hk-01 的 SSH 私钥',
      content:
        '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----',
      // 故意传 public，应被 enforceSensitivity 强制改成 secret
      sensitivity: 'public',
      tags: ['infra/ssh'],
      origin,
    })
    assert.equal(store.memories.get(m.id)?.sensitivity, 'secret')

    // 解锁状态下能读到明文
    assert.ok(store.memories.get(m.id)?.content.includes('BEGIN OPENSSH'))

    // 上锁后只剩占位符
    store.vault.lock()
    const locked = store.memories.get(m.id)
    assert.equal(locked?.locked, true)
    assert.ok(!locked?.content.includes('BEGIN OPENSSH'), '上锁后绝不能泄露明文')

    // 重新解锁
    store.vault.unlockWithPassphrase('correct horse battery staple')
    assert.ok(store.memories.get(m.id)?.content.includes('BEGIN OPENSSH'))
  })

  it('secret 记忆的正文不进全文索引', () => {
    const hits = store.memories.fullTextSearch('OPENSSH PRIVATE', 10)
    assert.equal(hits.length, 0, '加密内容绝不能出现在 FTS 表里')
    // 但标题仍可搜到，否则用户找不到这条记忆
    const byTitle = store.memories.fullTextSearch('server-hk-01', 10)
    assert.ok(byTitle.length > 0, '标题应该可搜索')
  })

  it('错误口令无法解锁', () => {
    store.vault.lock()
    assert.throws(() => store.vault.unlockWithPassphrase('wrong'), /口令错误/)
    store.vault.unlockWithPassphrase('correct horse battery staple')
  })
})

describe('VectorIndex', () => {
  it('近邻检索按余弦相似度排序', () => {
    const ids = ['v1', 'v2', 'v3']
    const vecs = [
      new Float32Array([1, 0, 0]),
      new Float32Array([0.9, 0.1, 0]),
      new Float32Array([0, 1, 0]),
    ]
    for (let i = 0; i < ids.length; i++) {
      const m = store.memories.insert({ kind: 'fact', title: ids[i]!, content: ids[i]!, origin })
      store.vectors.upsert(store.db, m.id, 'test', vecs[i]!)
      ids[i] = m.id
    }
    const res = store.vectors.search(new Float32Array([1, 0, 0]), 3, (id) => ids.includes(id))
    assert.equal(res[0]?.id, ids[0], '完全相同的向量应排第一')
    assert.equal(res[1]?.id, ids[1])
    assert.ok(res[0]!.score > res[2]!.score)
  })

  it('重启后能从磁盘恢复向量', () => {
    const before = store.vectors.size
    store.vectors.load(store.db)
    assert.equal(store.vectors.size, before)
  })
})

describe('图谱与实体', () => {
  it('同一对节点的重复边只保留权重更高的那条', () => {
    const a = store.memories.insert({ kind: 'fact', title: 'E1', content: 'x', origin })
    const b = store.memories.insert({ kind: 'fact', title: 'E2', content: 'y', origin })
    store.edges.upsert({ sourceId: a.id, targetId: b.id, kind: 'semantic', weight: 0.5 })
    store.edges.upsert({ sourceId: a.id, targetId: b.id, kind: 'semantic', weight: 0.9 })
    const edges = store.edges.neighbors(a.id)
    assert.equal(edges.length, 1)
    assert.equal(edges[0]?.weight, 0.9)
  })

  it('实体按规范化 key 合并并累计提及次数', () => {
    const e1 = store.entities.upsert('host', 'Server-HK-01', ['香港服务器'])
    const e2 = store.entities.upsert('host', 'server-hk-01')
    assert.equal(e1.id, e2.id, '大小写不同应视为同一实体')
    assert.equal(store.entities.get(e1.id)?.mentionCount, 2)
    assert.ok(store.entities.get(e1.id)?.aliases.includes('香港服务器'))
  })
})

describe('摄取游标', () => {
  it('断点位置能存取', () => {
    store.cursors.save({
      sourceRef: '/tmp/session.jsonl',
      agent: 'pi',
      offset: 4096,
      lastModified: 1700000000,
      messageCount: 12,
    })
    const c = store.cursors.get('/tmp/session.jsonl')
    assert.equal(c?.offset, 4096)
    assert.equal(c?.agent, 'pi')
  })
})

describe('租约', () => {
  it('同一时刻只有一个持有者', () => {
    assert.equal(store.acquireLease('ingest', 'proc-a', 60_000), true)
    assert.equal(store.acquireLease('ingest', 'proc-b', 60_000), false, '第二个进程不该抢到')
    assert.equal(store.acquireLease('ingest', 'proc-a', 60_000), true, '持有者续租应成功')
    store.releaseLease('ingest', 'proc-a')
    assert.equal(store.acquireLease('ingest', 'proc-b', 60_000), true, '释放后他人可接管')
  })
})
