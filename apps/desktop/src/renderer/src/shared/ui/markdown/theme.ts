import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * 编辑器配色。
 *
 * 全部走 CSS 变量而不是写死颜色 —— 主题切换时编辑器要跟着变，
 * 而 CodeMirror 的样式是注入到 shadow 之外的普通 class，
 * 变量在这里照样生效。
 */
const base = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontSize: '13px',
  },
  '.cm-content': {
    /* 与预览区的 px-4 py-3 完全一致，分栏时两边首行才在同一水平线上 */
    padding: '12px 16px',
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.75',
    caretColor: 'var(--accent)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selected)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selected)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-scroller': { fontFamily: 'inherit' },
})

/**
 * Markdown 标记的高亮。
 *
 * 刻意克制：只把结构性的东西（标题、代码、链接）区分出来，
 * 让人一眼看出层级。把每种语法都上色反而会让源文变得比渲染结果还花。
 */
const highlight = HighlightStyle.define([
  // 字号必须与预览的 h1/h2/h3 逐项相等，分栏时同一个标题才在同一水平线上
  { tag: tags.heading1, fontSize: '1.35em', fontWeight: '600' },
  { tag: tags.heading2, fontSize: '1.18em', fontWeight: '600' },
  { tag: tags.heading3, fontSize: '1.05em', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--info)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--text-faint)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--success)' },
  { tag: tags.quote, color: 'var(--text-muted)' },
  { tag: tags.list, color: 'var(--text-muted)' },
  // 标记符号本身淡化 —— 它们是脚手架，不是内容
  { tag: tags.processingInstruction, color: 'var(--text-faint)' },
  { tag: tags.contentSeparator, color: 'var(--text-faint)' },
])

export const editorTheme = [base, syntaxHighlighting(highlight)]
