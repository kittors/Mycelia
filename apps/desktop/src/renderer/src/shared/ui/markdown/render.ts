import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import markedKatex from 'marked-katex-extension'

/**
 * Markdown → HTML。
 *
 * 支持 GFM 全套（表格、任务列表、删除线）、数学公式、代码高亮。
 *
 * 必须过一遍消毒：知识库里的内容来自剪贴板、挂载的目录、agent 写入，
 * 没有一处是可信的。而这里渲染出来的 HTML 直接进 DOM —— 一段
 * `<img onerror=...>` 就够在应用里执行任意脚本，何况它还能读到
 * 整个知识库和保险箱。
 */

marked.use({ breaks: true, gfm: true })

/**
 * 数学公式。
 *
 * throwOnError 关掉：写公式的过程中必然经过无数个语法不完整的中间态，
 * 每敲一个字符就红一次会让人没法写。渲染不出来就原样显示，
 * 等式子写完自然就对了。
 */
marked.use(markedKatex({ throwOnError: false, nonStandard: true }))

/**
 * 代码高亮用 highlight.js 的 common 子集。
 *
 * 全量包含近两百种语言、体积翻好几倍，而知识库里的代码块
 * 九成是那二十来种常见语言。认不出的语言原样输出，不影响阅读。
 */
marked.use(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  }),
)

/**
 * 任务列表的勾选框自己画，不用 `<input type="checkbox">`。
 *
 * 两个原因：消毒器会剥掉 input 的 type 属性（表单元素在 XSS 里是重灾区，
 * 白名单加不回来），剥完剩下一个没有外形的输入框，看上去就是一片空白；
 * 而且它本来就是 disabled 的纯装饰，用系统原生控件会在这套中性灰的界面里
 * 突兀地出现一个蓝色方块。
 */
marked.use({
  renderer: {
    checkbox({ checked }) {
      return `<span class="task-check${checked ? ' is-done' : ''}" aria-hidden="true"></span>`
    },
  },
})

/** 外链一律新窗口打开，且切断 opener —— 被打开的页面不该能操作我们 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer noopener')
  }
})

/**
 * front matter 渲染成属性表。
 *
 * 既不能原样交给 Markdown 解析器（那道 `---` 会被当成 setext 标题的下划线，
 * 元数据变成一大块加粗文字压在开头），也不该直接丢掉 —— 里面的 name、
 * description、type 是这篇文档的身份信息，正是「这篇在讲什么」的最短答案。
 *
 * 自己解析而不是引 YAML 库：front matter 在实际笔记里九成是平铺的
 * `键: 值`，为这点结构背一个解析器不划算。遇到真正复杂的 YAML
 * （数组、多行字符串）就整块原样显示，至少不会错。
 */
function splitFrontMatter(source: string): { meta: string; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match?.[1]) return { meta: '', body: source }

  const rows: Array<[string, string]> = []
  let prefix = ''
  for (const raw of match[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const pair = raw.match(/^(\s*)([^:]+):\s*(.*)$/)
    if (!pair) return { meta: '', body: source.slice(match[0].length) }

    const [, indent = '', key = '', value = ''] = pair
    if (!value) {
      // 「metadata:」这种只有键没有值的，是下一层的容器
      prefix = indent ? prefix : `${key.trim()}.`
      continue
    }
    rows.push([indent ? `${prefix}${key.trim()}` : key.trim(), value.trim()])
  }

  const meta = rows
    .map(
      ([key, value]) =>
        `<div class="fm-row"><span class="fm-key">${escapeHtml(key)}</span>` +
        `<span class="fm-value">${escapeHtml(value)}</span></div>`,
    )
    .join('')

  return {
    meta: meta ? `<div class="front-matter">${meta}</div>` : '',
    body: source.slice(match[0].length),
  }
}

/** 属性值直接进 HTML，得先转义 —— 它随后还要过 DOMPurify，但不该指望下游兜底 */
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

export function renderMarkdown(source: string): string {
  const { meta, body } = splitFrontMatter(source)
  const html = meta + marked.parse(body, { async: false })
  return DOMPurify.sanitize(html, {
    // KaTeX 输出大量 MathML 与带样式的 span，默认白名单会把它们剥光
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_TAGS: ['annotation', 'semantics', 'mstyle'],
    // type 得显式加回来：少了它，任务列表的勾选框会退化成一个没有外形的
    // 文本输入框 —— 元素还在，但看上去只是一片诡异的空白
    ADD_ATTR: ['aria-hidden', 'style', 'class'],
    // asset:// 是本地图片的协议，默认白名单不认它
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|asset|data:image\/)/i,
  })
}
