import { useEffect, useState } from 'react'
import { Button, Icon, MarkdownEditor } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

/**
 * 文档编辑。
 *
 * 占满整个内容区，而不是塞进抽屉 —— 抽屉宽度就那么点，分栏预览会被挤成
 * 两条竖缝，而写文档恰恰是最需要横向空间的场景。弹窗在语义上也是
 * 「打断一下、做个快速决定」，跟写作要的沉浸感是相反的。
 *
 * 对照：写记忆仍然用抽屉，因为那是一个标题加几句话的事，
 * 打开个整页反而小题大做。判断标准是内容的体量，不是操作的类型。
 */
export function DocumentEditor({
  documentId,
  onClose,
  onSaved,
}: {
  /** 传了就是编辑那一篇，不传是新建 */
  documentId?: string
  onClose: () => void
  onSaved: (documentId: string) => void
}) {
  const app = useApp()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(Boolean(documentId))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!documentId) return
    let alive = true
    void window.mycelia
      .readNote(documentId)
      .then((note) => {
        if (!alive || !note) return
        setTitle(note.document.title)
        setText(note.text)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [documentId])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.mycelia.saveNote({
        title: title.trim(),
        text: text.trim(),
        documentId,
      })
      app.toast(`已入库，切成 ${result.chunkCount} 个片段`, 'success')
      app.bump()
      setDirty(false)
      onSaved(result.documentId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 有未保存的改动时拦一下再走。
   *
   * 写了半小时的东西被一次误触清掉，是没有任何补救办法的 ——
   * 编辑器里没有草稿箱，退出即丢失。
   */
  const close = () => {
    if (dirty && !window.confirm('有未保存的修改，确定放弃吗？')) return
    onClose()
  }

  // Esc 退出，与设置页保持一致
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      // ⌘S / Ctrl+S 保存 —— 长文编辑时手会自己去按
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        if (title.trim() && text.trim() && !busy) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const canSave = Boolean(title.trim() && text.trim()) && !busy && !loading

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-canvas">
      <header className="flex items-center gap-3 h-[46px] px-3 shrink-0 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={close}
          icon={<Icon name="chevron" size={13} className="rotate-180" />}
        >
          返回
        </Button>

        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setDirty(true)
          }}
          placeholder="给这篇文档起个标题"
          className="flex-1 min-w-0 h-8 px-2 bg-transparent text-[14px] font-medium outline-none placeholder:text-faint placeholder:font-normal"
        />

        {dirty && <span className="text-[11px] text-faint shrink-0">未保存</span>}
        <Button variant="primary" size="sm" disabled={!canSave} onClick={save}>
          {busy ? '入库中…' : '入库'}
        </Button>
      </header>

      {error && (
        <div className="px-4 py-2 text-[12px] text-danger border-b border-border shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 p-3">
        <MarkdownEditor
          value={text}
          onChange={(next) => {
            setText(next)
            setDirty(true)
          }}
          placeholder={loading ? '读取中…' : '直接粘贴 Markdown，或从零开始写'}
          className="h-full"
        />
      </div>

      <footer className="flex items-center gap-3 px-4 py-2 shrink-0 border-t border-border text-[11px] text-faint">
        <span>标题层级决定切分，写清楚层级检索会更准</span>
        <div className="flex-1" />
        <span>⌘S 保存 · Esc 返回</span>
      </footer>
    </div>
  )
}
