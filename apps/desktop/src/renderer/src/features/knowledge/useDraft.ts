import { useEffect, useRef, useState } from 'react'

/**
 * 编辑中的内容实时留底。
 *
 * 有了它，"未保存"这个状态就不存在了 —— 界面上不需要提醒用户去保存，
 * 退出时也不需要拦一道确认。那类提示是把本该由程序承担的事推给人：
 * 写东西的人应该只关心写，落不落库是另一件事。
 *
 * 草稿只落在本地，不进库。真正的入库要重新分块、重新向量化，代价高得多，
 * 不能每敲一个字就来一遍；而草稿只是一个字符串写进 localStorage，
 * 随手写随手丢都没关系。
 */

/** 敲字期间不必每次都写盘，停下来的一瞬间落一次就够 */
const DEBOUNCE_MS = 400

interface Draft {
  title: string
  text: string
}

function keyOf(documentId?: string): string {
  return `mycelia:draft:${documentId ?? 'new'}`
}

export function readDraft(documentId?: string): Draft | null {
  try {
    const raw = localStorage.getItem(keyOf(documentId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (typeof parsed.title !== 'string' || typeof parsed.text !== 'string') return null
    return { title: parsed.title, text: parsed.text }
  } catch {
    // 存储被禁用或内容损坏：当作没有草稿，不能让它挡住编辑器打开
    return null
  }
}

export function clearDraft(documentId?: string): void {
  try {
    localStorage.removeItem(keyOf(documentId))
  } catch {
    /* 同上 */
  }
}

export function useDraft(
  documentId: string | undefined,
  draft: Draft,
  /** 关掉之后才开始留底 —— 否则读取已有文档时会把空内容覆盖掉真草稿 */
  enabled: boolean,
) {
  const [restored, setRestored] = useState<Draft | null>(null)
  const timer = useRef(0)

  // 打开时先看有没有上次留下的
  useEffect(() => {
    if (!enabled) return
    setRestored(readDraft(documentId))
    // 只在挂载和文档切换时看一次，之后的变化都是本次编辑自己写的
  }, [documentId, enabled])

  useEffect(() => {
    if (!enabled) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      try {
        if (!draft.title.trim() && !draft.text.trim()) clearDraft(documentId)
        else localStorage.setItem(keyOf(documentId), JSON.stringify(draft))
      } catch {
        /* 存不下就算了，不能因为留底失败打断编辑 */
      }
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer.current)
  }, [documentId, draft, enabled])

  return {
    /** 与当前内容不同的历史草稿，供界面询问是否恢复 */
    restored,
    dismiss: () => setRestored(null),
  }
}
