import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'

export interface JsonlReadResult<T> {
  records: T[]
  /** 读到的新字节偏移，写回游标 */
  offset: number
  /** 文件被截断或替换过（比如 agent 重写了会话文件） */
  truncated: boolean
}

/**
 * 从字节偏移处增量读取 JSONL。
 *
 * 这是整个摄取链路的性能关键：用户机器上有 9MB 单文件的 pi 会话、
 * GB 级的 codex 历史目录。每次轮询都全量解析是不可接受的，
 * 所以严格按 offset 续读，只解析新追加的字节。
 */
export async function readJsonlFrom<T = unknown>(
  path: string,
  offset = 0,
): Promise<JsonlReadResult<T>> {
  const info = await stat(path)

  // 文件比游标还短 → 被截断或替换，从头再来
  if (info.size < offset) {
    return { ...(await readAll<T>(path)), truncated: true }
  }
  if (info.size === offset) {
    return { records: [], offset, truncated: false }
  }

  return { ...(await readRange<T>(path, offset, info.size)), truncated: false }
}

async function readAll<T>(path: string): Promise<{ records: T[]; offset: number }> {
  const info = await stat(path)
  return readRange<T>(path, 0, info.size)
}

async function readRange<T>(
  path: string,
  start: number,
  end: number,
): Promise<{ records: T[]; offset: number }> {
  const records: T[] = []
  let consumed = start

  const stream = createReadStream(path, { start, encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })

  let lastCompleteOffset = start
  for await (const line of rl) {
    // +1 是换行符。注意这里用字节长度而非字符数 —— 中文会话里两者差三倍
    consumed += Buffer.byteLength(line, 'utf8') + 1
    const trimmed = line.trim()
    if (!trimmed) {
      lastCompleteOffset = consumed
      continue
    }
    try {
      records.push(JSON.parse(trimmed) as T)
      lastCompleteOffset = consumed
    } catch {
      // 最后一行可能是写了一半的 JSON（agent 正在写入）。
      // 不推进 offset，下次轮询会重读这一行。
      break
    }
  }

  rl.close()
  stream.destroy()

  return { records, offset: Math.min(lastCompleteOffset, end) }
}
