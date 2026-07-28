import type { MemoryKind, Sensitivity } from '@mycelia/shared'
import { type FormEvent, useState } from 'react'
import { KIND_LABELS, SENSITIVITY_LABELS } from '../../shared/lib/labels.js'
import { Button, Drawer, Field, Input, Select, TagPicker, Textarea } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

export function MemoryComposer() {
  const close = () => useApp.getState().openComposer(false)
  const app = useApp()

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [kind, setKind] = useState<MemoryKind>('fact')
  const [sensitivity, setSensitivity] = useState<Sensitivity>('private')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 凭据强制加密，这是 store 层的硬规则，UI 上直接锁死避免误导
  const isCredential = kind === 'credential'
  const effectiveSensitivity = isCredential ? 'secret' : sensitivity

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await window.mycelia.createMemory({
        title: title.trim(),
        content: content.trim(),
        kind,
        tags,
        sensitivity: effectiveSensitivity,
        importance: 0.7,
      })
      app.toast('记忆已写入', 'success')
      app.bump()
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <Drawer
      title="写入记忆"
      description="手动写入不经过价值把关"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || !title.trim() || !content.trim()}
            onClick={submit}
          >
            {busy ? '写入中…' : '写入'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5 px-4 py-4">
        <Field label="标题" hint="脱离上下文也能看懂，别写「服务器配置」这种">
          <Input
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例：server-hk-01 的 SSH 登录方式"
          />
        </Field>

        <Field label="正文" hint="自包含，不要出现「上面提到的」这类指代">
          <Textarea
            required
            rows={11}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="记录结论、上下文，以及未来的你需要知道的细节"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="类型">
            <Select
              value={kind}
              onChange={setKind}
              options={Object.entries(KIND_LABELS).map(([id, label]) => ({
                value: id as MemoryKind,
                label,
              }))}
            />
          </Field>

          <Field label="敏感度" hint={isCredential ? '凭据类型强制加密' : undefined}>
            <Select
              value={effectiveSensitivity}
              disabled={isCredential}
              onChange={setSensitivity}
              options={Object.entries(SENSITIVITY_LABELS).map(([id, label]) => ({
                value: id as Sensitivity,
                label,
              }))}
            />
          </Field>
        </div>

        <Field label="标签" hint="层级形式，如 infra/ssh。优先选已有的，避免同义标签各立门户">
          <TagPicker value={tags} onChange={setTags} />
        </Field>

        {error && <p className="text-[12px] text-danger">{error}</p>}
      </form>
    </Drawer>
  )
}
