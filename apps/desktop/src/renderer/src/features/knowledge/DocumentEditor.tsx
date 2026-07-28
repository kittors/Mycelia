import { useEffect, useMemo, useState } from 'react'
import { Button, Icon, MarkdownEditor } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'
import { clearDraft, useDraft } from './useDraft.js'

/**
 * 文档编辑。
 *
 * 占满整个内容区，而不是塞进抽屉 —— 抽屉宽度就那么点，分栏预览会被挤成
 * 两条竖缝，而写文档恰恰是最需要横向空间的场景。弹窗在语义上也是
 * 「打断一下、做个快速决定」，跟写作要的沉浸感是相反的。
 *
 * 对照：写记忆仍然用抽屉，因为那是一个标题加几句话的事，
 * 打开个整页反而小题大做。判断标准是内容的体量，不是操作的类型。
 *
 * 没有「保存」这个动作。敲下的每个字都实时留了底（见 useDraft），
 * 退出不会丢，所以界面上不提醒保存、退出也不拦一道确认 ——
 * 那类提示是把本该由程序承担的事推给人。按钮做的是入库：
 * 分块、向量化、进检索，这才是一次需要用户明确表态的操作。
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
  const [error, setError] = useState('')

  const draft = useMemo(() => ({ title, text }), [title, text])
  const { restored, dismiss } = useDraft(documentId, draft, !loading)

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
      app.toast(documentId ? '已更新' : `已入库，切成 ${result.chunkCount} 个片段`, 'success')
      app.bump()
      // 已经落库了，草稿留着只会在下次打开时冒出来问要不要恢复
      clearDraft(documentId)
      onSaved(result.documentId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  // Esc 直接走，内容都在草稿里
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      // ⌘S 是肌肉记忆，按了就入库；界面上不再宣传它
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        if (title.trim() && text.trim() && !busy) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const canSave = Boolean(title.trim() && text.trim()) && !busy && !loading
  // 内容一致就不必问了 —— 那是上次入库后留下的同一份东西
  const offerRestore = restored && (restored.title !== title || restored.text !== text)

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-canvas">
      <header className="flex items-center gap-3 h-[46px] px-3 shrink-0 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          icon={<Icon name="chevron" size={13} className="rotate-180" />}
        >
          返回
        </Button>

        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="给这篇文档起个标题"
          className="flex-1 min-w-0 h-8 px-2 bg-transparent text-[14px] font-medium outline-none placeholder:text-faint placeholder:font-normal"
        />

        <Button variant="primary" size="sm" disabled={!canSave} onClick={save}>
          {busy ? (documentId ? '更新中…' : '入库中…') : documentId ? '保存' : '入库'}
        </Button>
      </header>

      {offerRestore && (
        <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b border-border bg-hover text-[12px]">
          <Icon name="timeline" size={12} className="text-faint shrink-0" />
          <span className="flex-1 min-w-0 truncate">上次离开时还有没入库的编辑</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTitle(restored.title)
              setText(restored.text)
              dismiss()
            }}
          >
            恢复
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            忽略
          </Button>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 text-[12px] text-danger border-b border-border shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 p-3">
        <MarkdownEditor
          value={text}
          onChange={setText}
          placeholder={loading ? '读取中…' : '直接粘贴 Markdown，或从零开始写'}
          className="h-full"
        />
      </div>

      <footer className="flex items-center gap-3 px-4 py-2 shrink-0 border-t border-border text-[11px] text-faint">
        <span>标题层级决定切分，写清楚层级检索会更准</span>
        <div className="flex-1" />
        <span>编辑内容随时留底，{documentId ? '保存' : '入库'}后才进检索</span>
      </footer>
    </div>
  )
}
