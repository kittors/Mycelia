import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectSecrets, redact } from './detect.js'

/**
 * 这些用例全部来自真实的中文运维笔记。
 *
 * 安全代码最怕的是「改一条规则、悄悄漏掉一类写法」—— 漏掉的后果不是
 * 报错，而是密码跟着文档一起发给了模型，没有任何人会发现。所以每修一个
 * 漏检就在这里钉一颗钉子。
 */
describe('凭据探测', () => {
  it('中文冒号的密码也要捕获', () => {
    const r = redact('| 密码：Xk9#mQ2vLp8w |')
    assert.equal(r.matches.length, 1)
    assert.ok(!r.text.includes('Xk9#mQ2vLp8w'))
  })

  it('反引号包裹、没有冒号的写法', () => {
    const r = redact('MySQL 密码 `JDRCw8kTTxAeR`')
    assert.equal(r.matches.length, 1)
    assert.ok(!r.text.includes('JDRCw8kTTxAeR'))
  })

  it('反引号不该被算进值里', () => {
    const r = redact('密码：`redis_fakePw01`')
    assert.ok(r.matches[0] !== undefined && !r.text.includes('redis_fakePw01'))
  })

  it('环境变量形式', () => {
    const r = redact('WX_MINIAPP_SECRET=abcdef0123456789abcdef0123456789')
    assert.equal(r.matches.length, 1)
  })

  it('有提示词的那处一定要抹掉', () => {
    const r = redact('密码：SuperSecret123')
    assert.ok(!r.text.includes('SuperSecret123'))
  })

  it('私钥路径不是秘密，不该被替换', () => {
    const text = 'ssh -i ~/.ssh/id_ed25519 root@1.2.3.4'
    const r = redact(text)
    assert.equal(r.text, text)
  })

  it('占位符不该被当成真值', () => {
    const text = 'password = <your-password>'
    assert.equal(redact(text).text, text)
  })

  it('IP、主机名这些检索锚点必须保留', () => {
    const r = redact('SSH root@1.2.3.4，密码：Xk9#mQ2vLp8w')
    assert.ok(r.text.includes('1.2.3.4'))
    assert.ok(r.text.includes('SSH'))
  })

  it('同一个密码换种写法也要认出来', () => {
    assert.equal(redact('密码：SharedPassw0rd').matches.length, 1)
    assert.equal(redact('口令：SharedPassw0rd').matches.length, 1)
  })

  it('没有凭据时原样返回', () => {
    const text = '# 标题\n\n这是一段普通的文档，没有任何密钥。'
    const r = redact(text)
    assert.equal(r.text, text)
    assert.equal(r.matches.length, 0)
  })
})
