import { tags } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

/**
 * 让编辑器认识 front matter。
 *
 * 不认的话，开头那道 `---` 会被当成 setext 标题的下划线 —— 于是
 * `name: xxx`、`description: xxx` 全被渲染成粗体大字压在文档最上面，
 * 而它们只是元数据，本该是最不显眼的部分。
 *
 * Markdown 标准里没有 front matter，@lezer/markdown 自然也没有内置。
 * 但它是 Obsidian、Hugo、Jekyll 以及这台机器上大部分笔记的通用约定，
 * 值得单独认一下。
 */
export const frontMatter: MarkdownConfig = {
  defineNodes: [
    // 用 meta 而不是 comment：它不是注释，是结构化数据，只是不该抢视觉重心
    { name: 'FrontMatter', block: true, style: tags.meta },
    { name: 'FrontMatterMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'FrontMatter',
      // 必须排在分割线之前，否则那道 --- 先被它认走
      before: 'HorizontalRule',
      parse(cx, line) {
        // 只认文档最开头的那一段：正文中间的 --- 是货真价实的分割线
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false

        const start = cx.lineStart
        const marks = [cx.elt('FrontMatterMark', start, start + 3)]

        while (cx.nextLine()) {
          if (/^---\s*$/.test(line.text)) {
            marks.push(cx.elt('FrontMatterMark', cx.lineStart, cx.lineStart + 3))
            const end = cx.lineStart + line.text.length
            cx.nextLine()
            cx.addElement(cx.elt('FrontMatter', start, end, marks))
            return true
          }
        }

        /**
         * 没找到收尾的那道 ---。
         *
         * 这时不能当作 front matter 处理：正在写、还没敲完收尾的文档就属于
         * 这种状态，硬吞下去会让后面所有内容突然失去高亮。返回 false 交回
         * 给默认规则，最多就是暂时显示成标题。
         */
        return false
      },
    },
  ],
}
