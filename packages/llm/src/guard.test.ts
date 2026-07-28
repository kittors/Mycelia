import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { guardEgress } from './guard.js'
import type { ChatMessage, LlmProvider } from './types.js'

/** record 下所有真正发出去的内容，用来断言凭据没跟着走 */
function spy(): { provider: LlmProvider; sent: ChatMessage[][] } {
  const sent: ChatMessage[][] = []
  const provider: LlmProvider = {
    id: 'spy',
    model: 'spy',
    enabled: true,
    chat: async (messages) => {
      sent.push([...messages])
      return { text: '', model: 'spy' }
    },
    test: async () => ({ ok: true, message: '' }),
  }
  return { provider: guardEgress(provider), sent }
}

describe('出网闸', () => {
  it('密码不会发出去', async () => {
    const { provider, sent } = spy()
    await provider.chat([{ role: 'user', content: '服务器密码：Xk9#mQ2vLp8w' }])
    assert.ok(!JSON.stringify(sent).includes('Xk9#mQ2vLp8w'))
  })

  it('抹掉的只是值，上下文要留着', async () => {
    const { provider, sent } = spy()
    await provider.chat([{ role: 'user', content: 'SSH root@1.2.3.4，密码：Xk9#mQ2vLp8w' }])
    const out = sent[0]?.[0]?.content ?? ''
    assert.ok(out.includes('1.2.3.4'), '主机地址是检索锚点，不该被抹')
    assert.ok(out.includes('密码'), '键名要留着，否则模型不知道这段在讲什么')
  })

  it('没有凭据的消息原样通过', async () => {
    const { provider, sent } = spy()
    const text = '这是一段普通的文档，没有任何密钥。'
    await provider.chat([{ role: 'user', content: text }])
    assert.equal(sent[0]?.[0]?.content, text)
  })

  it('多条消息逐条过闸', async () => {
    const { provider, sent } = spy()
    await provider.chat([
      { role: 'system', content: 'api_key = sk-abcdefghijklmnopqrstuvwxyz012345' },
      { role: 'user', content: '正常内容' },
    ])
    const dump = JSON.stringify(sent)
    assert.ok(!dump.includes('sk-abcdefghijklmnopqrstuvwxyz012345'))
    assert.ok(dump.includes('正常内容'))
  })
})
