import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chunkDocument, parseBlocks, splitBySentence } from './chunk/index.js'

const OPTIONS = { chunkSize: 300, chunkOverlap: 40 }

describe('文档结构解析', () => {
  it('代码围栏整体成块，围栏内的井号不当标题', () => {
    const text = ['# 标题', '', '```bash', '# 这是注释不是标题', 'echo hi', '```', '', '正文'].join(
      '\n',
    )
    const blocks = parseBlocks(text)
    const code = blocks.filter((b) => b.type === 'code')
    const headings = blocks.filter((b) => b.type === 'heading')

    assert.equal(code.length, 1)
    assert.ok(code[0]!.text.includes('# 这是注释不是标题'))
    assert.equal(headings.length, 1, '围栏内的 # 不应被识别为标题')
  })

  it('表格与列表标记为原子块', () => {
    const text = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '', '- 第一项', '- 第二项'].join('\n')
    const blocks = parseBlocks(text)
    assert.equal(blocks.find((b) => b.type === 'table')?.atomic, true)
    assert.equal(blocks.find((b) => b.type === 'list')?.atomic, true)
  })
})

describe('分块的碎片化防护', () => {
  it('超长代码块宁可超出容量也不切开', () => {
    const code = Array.from({ length: 60 }, (_, i) => `const line${i} = ${i}`).join('\n')
    const text = `# 示例\n\n\`\`\`ts\n${code}\n\`\`\`\n`
    const chunks = chunkDocument(text, OPTIONS)

    const holding = chunks.filter((c) => c.content.includes('```'))
    assert.equal(holding.length, 1, '代码块被拆散了')
    assert.ok(holding[0]!.content.includes('const line0'))
    assert.ok(holding[0]!.content.includes('const line59'))
    assert.ok(holding[0]!.content.length > OPTIONS.chunkSize, '这个块本就该超出目标长度')
  })

  it('每个块都带完整的标题路径', () => {
    const text = [
      '# 部署',
      '',
      '总体说明。',
      '',
      '## 生产环境',
      '',
      '生产环境的说明文字。',
      '',
      '### 回滚',
      '',
      '回滚步骤的说明。',
    ].join('\n')

    const chunks = chunkDocument(text, OPTIONS)
    const rollback = chunks.find((c) => c.content.includes('回滚步骤'))
    assert.equal(rollback?.heading, '部署 › 生产环境 › 回滚')
  })

  it('同级标题切换时弹出旧标题，不会越积越深', () => {
    const text = ['# A', '', '## A1', '', '内容一。', '', '## A2', '', '内容二。'].join('\n')
    const chunks = chunkDocument(text, OPTIONS)
    assert.equal(chunks.find((c) => c.content.includes('内容二'))?.heading, 'A › A2')
  })

  it('不同小节的内容不会被合并进同一个块', () => {
    const text = ['# 甲', '', '甲的内容。', '', '# 乙', '', '乙的内容。'].join('\n')
    const chunks = chunkDocument(text, OPTIONS)

    const merged = chunks.find(
      (c) => c.content.includes('甲的内容') && c.content.includes('乙的内容'),
    )
    assert.equal(merged, undefined, '跨小节的内容被黏在一起了')
    assert.equal(chunks.length, 2)
    assert.deepEqual(
      chunks.map((c) => c.heading),
      ['甲', '乙'],
    )
  })

  it('块的字符区间能定位回原文', () => {
    const text = ['# 标题', '', '第一段内容。', '', '第二段内容。'].join('\n')
    const chunks = chunkDocument(text, OPTIONS)
    for (const chunk of chunks) {
      assert.ok(chunk.charStart >= 0)
      assert.ok(chunk.charEnd <= text.length)
      assert.ok(chunk.charEnd > chunk.charStart)
    }
  })

  it('空文档不产生块', () => {
    assert.deepEqual(chunkDocument('   \n\n  ', OPTIONS), [])
  })

  it('ord 连续递增', () => {
    const text = Array.from({ length: 12 }, (_, i) => `## 小节 ${i}\n\n这一节的内容说明。`).join(
      '\n\n',
    )
    const chunks = chunkDocument(text, OPTIONS)
    chunks.forEach((chunk, index) => {
      assert.equal(chunk.ord, index)
    })
  })
})

describe('超长段落的句子切分', () => {
  it('沿中文句号切开而不是硬切', () => {
    const sentence = '这是一个用来测试切分逻辑的句子。'
    const pieces = splitBySentence(sentence.repeat(20), 120, 0)

    assert.ok(pieces.length > 1)
    for (const piece of pieces) {
      assert.ok(piece.text.endsWith('。'), `切在了句子中间：${piece.text.slice(-20)}`)
    }
  })

  it('没有任何标点时也能终止并覆盖全文', () => {
    const text = 'a'.repeat(500)
    const pieces = splitBySentence(text, 100, 0)
    assert.ok(pieces.length >= 5)
    assert.equal(pieces.map((p) => p.text).join('').length, text.length)
  })
})
