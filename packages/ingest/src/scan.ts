import { type Dirent, existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSource } from '@mycelia/shared'
import type { DiscoverOptions, SourceRef } from './types.js'

/**
 * 递归扫描目录下的 JSONL 文件。
 * 提前用 mtime 过滤 —— codex 的会话目录按年月日分层，
 * 历史积累可能有上万个文件，只有真正变化过的才值得进入解析阶段。
 */
export async function scanJsonlFiles(
  root: string,
  agent: AgentSource,
  opts: DiscoverOptions = {},
): Promise<SourceRef[]> {
  if (!existsSync(root)) return []

  const out: SourceRef[] = []
  const exclude = opts.excludePaths ?? []

  async function walk(dir: string, depth: number) {
    if (depth > 6) return
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      if (exclude.some((p) => full.startsWith(p))) continue

      try {
        const info = await stat(full)
        if (opts.since && info.mtimeMs < opts.since) continue
        out.push({ ref: full, agent, modifiedAt: info.mtimeMs, sizeBytes: info.size })
      } catch {
        /* 文件在扫描过程中被删了，跳过 */
      }
    }
  }

  await walk(root, 0)

  // 最近改动的优先处理：用户最关心刚发生的对话
  out.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return opts.limit ? out.slice(0, opts.limit) : out
}

/**
 * 从 Claude Code / pi 的目录名反解出工作目录。
 * 它们把 `/Users/foo/bar` 编码成 `-Users-foo-bar`，
 * 这个还原是有损的（原本就带连字符的目录名会还原错），
 * 所以只作为兜底 —— 会话内容里带 cwd 字段时优先用那个。
 */
export function decodeCwdSlug(slug: string): string | undefined {
  const cleaned = slug.replace(/^-+|-+$/g, '')
  if (!cleaned) return undefined
  return `/${cleaned.replace(/-/g, '/')}`
}
