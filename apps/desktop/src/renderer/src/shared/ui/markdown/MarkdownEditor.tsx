import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn.js'
import { Icon } from '../Icon.js'
import { frontMatter } from './frontmatter.js'
import { renderMarkdown } from './render.js'
import { editorTheme } from './theme.js'
import { useImagePaste } from './useImagePaste.js'
import { useSyncScroll } from './useSyncScroll.js'

type Mode = 'write' | 'split' | 'preview'

/**
 * Markdown 编辑器。
 *
 * 编辑的就是 Markdown 源文，不是「富文本再转回 Markdown」——
 * 后者看着更花哨，实际有两个绕不过去的问题：
 *
 *   1. **粘贴会失真**。从别处复制一整篇 Markdown 进来，所见即所得编辑器
 *      会把它解析成内部节点树，再序列化回去时空行、缩进、引用嵌套
 *      多半已经不是原样了。而知识库最常见的用法恰恰就是「把写好的文档粘进来」。
 *   2. **分块管线依赖原文**。切块靠标题层级和代码围栏，往返转换一次
 *      就多一次错位的机会。
 *
 * 所以左边写源码、右边看效果 —— 源文永远是唯一的事实。
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 360,
}: {
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
  className?: string
  minHeight?: number
}) {
  const [view, setView] = useState<Mode>('split')
  const { paste, dropping, handlers, busy } = useImagePaste(onChange)
  const pane = useSyncScroll(view === 'split')

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [frontMatter] }),
      EditorView.lineWrapping,
      // 图片粘贴要在 CodeMirror 自己的 paste 处理之前截住
      EditorView.domEventHandlers({
        paste: (event, view) => paste(event, view),
      }),
    ],
    [paste],
  )

  const html = useMemo(() => (view === 'write' ? '' : renderMarkdown(value)), [value, view])

  return (
    <div
      className={cn(
        'flex flex-col rounded-[9px] border border-border bg-raised overflow-hidden',
        // 不做 focus 高亮：这是页面主体而不是表单控件，
        // 一进来就在编辑状态，整框描边只是无谓的视觉噪音
        'transition-[border-color,box-shadow] duration-150',
        dropping && 'border-accent ring-2 ring-accent/15',
        className,
      )}
      {...handlers}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-surface/60">
        <ModeTab active={view === 'write'} onClick={() => setView('write')}>
          编辑
        </ModeTab>
        <ModeTab active={view === 'split'} onClick={() => setView('split')}>
          分栏
        </ModeTab>
        <ModeTab active={view === 'preview'} onClick={() => setView('preview')}>
          预览
        </ModeTab>

        <div className="flex-1" />
        <span className="text-[10.5px] text-faint pr-1">
          {busy ? '正在处理图片…' : '支持粘贴 Markdown 与图片'}
        </span>
      </div>

      <div className="flex flex-1 min-h-0" style={{ minHeight }}>
        {view !== 'preview' && (
          <div
            ref={pane.left}
            className={cn('min-w-0 overflow-auto', view === 'split' ? 'w-1/2' : 'w-full')}
          >
            <CodeMirror
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              extensions={extensions}
              theme={editorTheme}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                // 自动补全括号在写 Markdown 时只会碍事
                closeBrackets: false,
                bracketMatching: false,
              }}
            />
          </div>
        )}

        {view === 'split' && <div className="w-px bg-border shrink-0" />}

        {view !== 'write' && (
          <div
            ref={pane.right}
            className={cn(
              // 字号行高交给 .prose-mycelia 自己定 —— 行网格的所有尺寸都从
              // 那一处推导，写在这里会变成第二个事实来源
              'min-w-0 overflow-auto px-4 py-3',
              view === 'split' ? 'w-1/2 bg-surface/30' : 'w-full',
            )}
          >
            {value.trim() ? (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: 已过 DOMPurify，见 render.ts
              <div className="prose-mycelia" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="text-[12px] text-faint">预览会显示在这里</p>
            )}
          </div>
        )}
      </div>

      {dropping && (
        <div className="flex items-center gap-1.5 px-4 py-2 text-[11.5px] text-accent border-t border-border bg-hover">
          <Icon name="plus" size={12} />
          松手插入图片
        </div>
      )}
    </div>
  )
}

function ModeTab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'px-2 h-[22px] rounded-[5px] text-[11.5px] cursor-pointer',
        'transition-colors duration-100',
        active ? 'bg-selected text-text' : 'text-muted hover:bg-hover hover:text-text',
      )}
    >
      {children}
    </button>
  )
}
