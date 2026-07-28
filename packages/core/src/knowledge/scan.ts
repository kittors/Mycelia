/**
 * 目录扫描与标题提取。
 *
 * 从 indexer 里分出来：那边关心的是「索引这条流水线怎么跑」，
 * 这里只回答「目录里有哪些文件、这篇文章叫什么」，两者的改动理由不同。
 */

import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { StoredSource } from '@mycelia/store'

interface ScannedFile {
  absPath: string
  relPath: string
  sizeBytes: number
  mtime: number
}

export type { ScannedFile }

export async function scanDirectory(source: StoredSource): Promise<ScannedFile[]> {
  const extensions = new Set(source.extensions.map((e) => e.toLowerCase().replace(/^\./, '')))
  const exclude = source.exclude
  const out: ScannedFile[] = []

  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      // 权限不足或目录中途消失：跳过而不是让整次索引失败
      return
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.name.startsWith('.') && entry.name !== '.') continue
      if (exclude.some((pattern) => entry.name === pattern || full.includes(pattern))) continue

      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue

      const ext = extname(entry.name).replace(/^\./, '').toLowerCase()
      if (!extensions.has(ext)) continue

      try {
        const info = await stat(full)
        out.push({
          absPath: full,
          relPath: relative(source.path, full),
          sizeBytes: info.size,
          mtime: info.mtimeMs,
        })
      } catch {
        /* 文件刚被删掉，忽略 */
      }
    }
  }

  await walk(source.path)
  return out
}

/** 标题优先取一级标题，其次 front-matter，最后退回文件名 */
export function extractTitle(text: string, relPath: string): string {
  const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (frontMatter?.[1]) {
    const titleLine = frontMatter[1].match(/^title:\s*(.+)$/m)
    if (titleLine?.[1]) return titleLine[1].trim().replace(/^["']|["']$/g, '')
  }
  const heading = text.match(/^#\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim()
  return basename(relPath, extname(relPath))
}
