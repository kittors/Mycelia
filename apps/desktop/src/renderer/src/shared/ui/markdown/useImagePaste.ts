import type { EditorView } from '@codemirror/view'
import { useCallback, useRef, useState } from 'react'

/**
 * 粘贴或拖入图片：存到本地，在光标处插入 Markdown 图片语法。
 *
 * 顺带做识图。图片进不了向量空间（嵌入模型吃的是文本），所以配了识图模型的话，
 * 让它先把图看成一段描述写进替代文字 —— 这段文字跟着正文一起分块、向量化，
 * 于是搜「架构图」能命中一张没有任何文字说明的白板照片。
 *
 * 识图慢，所以分两步：先插入占位的图让人能继续写，描述回来了再回填。
 */

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/

function extOf(mime: string): string {
  const sub = mime.split('/')[1] ?? 'png'
  return sub === 'jpeg' ? 'jpg' : sub
}

async function toBase64(file: File | Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  // 分块转换：一次性 apply 上百万个参数会爆栈
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function useImagePaste(onChange: (markdown: string) => void) {
  const [dropping, setDropping] = useState(false)
  const [busy, setBusy] = useState(false)
  const viewRef = useRef<EditorView | null>(null)

  /** 在光标处插入一段文本，并把光标移到插入内容之后 */
  const insertAtCursor = useCallback((view: EditorView, text: string) => {
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
  }, [])

  const handleFiles = useCallback(
    async (files: Array<File | Blob>, view: EditorView | null) => {
      const images = files.filter((f) => IMAGE_TYPES.test(f.type))
      if (images.length === 0 || !view) return

      setBusy(true)
      try {
        for (const file of images) {
          const base64 = await toBase64(file)
          const mime = file.type
          const { url } = await window.mycelia.saveImage({ base64, ext: extOf(mime) })

          // 先插入，别让人等识图 —— 那可能要好几秒
          const placeholder = `\n![图片](${url})\n`
          insertAtCursor(view, placeholder)
          onChange(view.state.doc.toString())

          try {
            const described = await window.mycelia.describeImage({ base64, mime })
            if (!described.enabled || !described.text) continue

            /**
             * 用文本替换而不是记录位置：识图期间用户很可能已经接着打字了，
             * 当初那个偏移量早就指向别处。按 URL 找回来才是稳的。
             */
            const alt = described.text.replace(/[\r\n]+/g, ' ').slice(0, 300)
            const current = view.state.doc.toString()
            const next = current.replace(`![图片](${url})`, `![${alt}](${url})`)
            if (next === current) continue

            view.dispatch({ changes: { from: 0, to: current.length, insert: next } })
            onChange(next)
          } catch {
            // 识图失败不影响图片本身已经存好了
          }
        }
      } finally {
        setBusy(false)
      }
    },
    [insertAtCursor, onChange],
  )

  /** 交给 CodeMirror 的 paste 处理器。返回 true 表示已接管，阻止默认粘贴 */
  const paste = useCallback(
    (event: ClipboardEvent, view: EditorView): boolean => {
      viewRef.current = view
      const items = [...(event.clipboardData?.items ?? [])]
      const images = items
        .filter((item) => IMAGE_TYPES.test(item.type))
        .map((item) => item.getAsFile())
        .filter((f): f is File => Boolean(f))

      // 没有图片就放行 —— 粘贴 Markdown 文本必须原样进去，一个字符都不能改
      if (images.length === 0) return false

      event.preventDefault()
      void handleFiles(images, view)
      return true
    },
    [handleFiles],
  )

  return {
    paste,
    dropping,
    busy,
    handlers: {
      onDragOver: (event: React.DragEvent) => {
        if (![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        setDropping(true)
      },
      onDragLeave: (event: React.DragEvent) => {
        // 拖过子元素也会冒泡出 dragleave，只在真正离开容器时收起提示
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDropping(false)
      },
      onDrop: (event: React.DragEvent) => {
        if (![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        setDropping(false)
        void handleFiles([...event.dataTransfer.files], viewRef.current)
      },
    },
  }
}
