import { type FormEvent, useEffect, useState } from 'react'
import { Button, Drawer, Field, Input, Textarea } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

/**
 * 手写知识。
 *
 * 和「写入记忆」是两件事，别混：记忆是一条条独立的结论，短、自包含；
 * 知识是成篇的材料，会被切块、做上下文增强后进 RAG 检索。
 * 所以这里的正文框给得很大 —— 它预期收到的是一整段文档，不是一句话。
 */
export function NoteComposer({
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

  // 编辑模式先把原文取回来
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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
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
      onSaved(result.documentId)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <Drawer
      title={documentId ? '编辑知识' : '手写知识'}
      description="会被切块并向量化，和挂载目录里的文档一样参与检索"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || loading || !title.trim() || !text.trim()}
            onClick={submit}
          >
            {busy ? '入库中…' : '入库'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5 px-4 py-4">
        <Field label="标题" hint="会成为检索结果里的定位标题">
          <Input
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例：生产环境部署流程"
          />
        </Field>

        <Field label="正文" hint="支持 Markdown。标题层级会被用来切分，写清楚层级检索会更准">
          <Textarea
            required
            rows={18}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={loading ? '读取中…' : '粘贴或输入完整的文档内容'}
          />
        </Field>

        {error && <p className="text-[12px] text-danger">{error}</p>}
      </form>
    </Drawer>
  )
}
