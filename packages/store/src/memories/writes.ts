/**
 * 记忆的写入路径。
 *
 * insert 与 update 都要同时照顾五件事：正文加解密、全文索引、标签计数、
 * 向量失效、审计留痕。任何一处遗漏都会让数据悄悄不一致，
 * 所以它们各自是一个完整事务，也因此值得从仓储类里单独拿出来。
 */

import type { Vault } from '@mycelia/crypto'
import type { Memory, MemoryInput, MemoryPatch } from '@mycelia/shared'
import { enforceSensitivity, hashContent, NotFoundError, newId } from '@mycelia/shared'
import type { Db } from '../db.js'
import { type MemoryRow, rowToMemory, type StoredMemory } from '../rows.js'
import type { VectorIndex } from '../vectors.js'
import { normalizeTags } from './query.js'
import { decryptContent } from './secrets.js'

/**
 * 写入所需的上下文。
 *
 * 传一个对象而不是六个参数 —— 这些依赖总是一起出现，
 * 而且未来还会增加（比如事件总线）。
 */
export interface WriteContext {
  db: Db
  vault: Vault | null
  vectors: VectorIndex
  hydrate(row: MemoryRow, decrypt: boolean): StoredMemory
  maybeEncrypt(content: string, sensitivity: string): string
  getRaw(id: string): MemoryRow | undefined
  syncFts(id: string, memory: Memory, sensitivity: string): void
  bumpTags(tags: readonly string[], now: number): void
  audit(actor: string, action: string, memoryId: string, detail: string): void
}

export function insertMemory(
  ctx: WriteContext,
  input: MemoryInput,
  actor = 'system',
): StoredMemory {
  const now = Date.now()
  const id = newId('mem')
  const sensitivity = enforceSensitivity(input.kind, input.sensitivity ?? 'public')
  const tags = normalizeTags(input.tags ?? [])
  const contentHash = hashContent(input.kind, input.title, input.content)

  const storedContent = ctx.maybeEncrypt(input.content, sensitivity)

  const memory: Memory = {
    id,
    kind: input.kind,
    title: input.title,
    content: input.content,
    summary: input.summary ?? '',
    tags,
    sensitivity,
    status: input.status ?? 'active',
    confidence: input.confidence ?? 0.8,
    importance: input.importance ?? 0.5,
    pinned: input.pinned ?? false,
    origin: input.origin,
    captureMode: input.captureMode ?? 'manual',
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: undefined,
    accessCount: 0,
    recallCount: 0,
    lastRecalledAt: undefined,
    expiresAt: input.expiresAt,
    contentHash,
    embeddingModel: input.embeddingModel,
  }

  ctx.db.transaction(() => {
    ctx.db
      .prepare(`
        INSERT INTO memories (
          id, kind, title, content, summary, tags, sensitivity, status,
          confidence, importance, pinned, origin, created_at, updated_at,
          last_accessed_at, access_count, expires_at, content_hash, embedding_model,
          capture_mode
        ) VALUES (
          @id, @kind, @title, @content, @summary, @tags, @sensitivity, @status,
          @confidence, @importance, @pinned, @origin, @created_at, @updated_at,
          NULL, 0, @expires_at, @content_hash, @embedding_model,
          @capture_mode
        )
      `)
      .run({
        id,
        kind: memory.kind,
        title: memory.title,
        content: storedContent,
        summary: memory.summary,
        tags: JSON.stringify(tags),
        sensitivity,
        status: memory.status,
        confidence: memory.confidence,
        importance: memory.importance,
        pinned: memory.pinned ? 1 : 0,
        origin: JSON.stringify(memory.origin),
        created_at: now,
        updated_at: now,
        expires_at: memory.expiresAt ?? null,
        content_hash: contentHash,
        embedding_model: memory.embeddingModel ?? null,
        capture_mode: memory.captureMode,
      })

    ctx.syncFts(id, memory, sensitivity)
    ctx.bumpTags(tags, now)
    ctx.audit(actor, 'create', id, memory.title)
  })()

  return memory
}

export function updateMemory(
  ctx: WriteContext,
  id: string,
  patch: MemoryPatch,
  actor = 'user',
): StoredMemory {
  const existing = ctx.getRaw(id)
  if (!existing) throw new NotFoundError('记忆', id)

  const now = Date.now()
  const kind = patch.kind ?? (existing.kind as Memory['kind'])
  const sensitivity = enforceSensitivity(
    kind,
    (patch.sensitivity ?? existing.sensitivity) as Memory['sensitivity'],
  )
  const title = patch.title ?? existing.title
  const tags = patch.tags ? normalizeTags(patch.tags) : JSON.parse(existing.tags)

  // 只有显式传了 content 才动正文；没传就保持原样（可能是密文，不能误解密再写回）
  let storedContent = existing.content
  let plainContent = decryptContent(ctx.vault, existing.content).text
  if (patch.content !== undefined) {
    plainContent = patch.content
    storedContent = ctx.maybeEncrypt(patch.content, sensitivity)
  } else if (sensitivity !== existing.sensitivity) {
    // 敏感度变了 → 需要重新加密或解密落盘内容
    storedContent = ctx.maybeEncrypt(plainContent, sensitivity)
  }

  const contentHash = hashContent(kind, title, plainContent)

  ctx.db.transaction(() => {
    ctx.db
      .prepare(`
        UPDATE memories SET
          kind = @kind, title = @title, content = @content, summary = @summary,
          tags = @tags, sensitivity = @sensitivity, status = @status,
          confidence = @confidence, importance = @importance, pinned = @pinned,
          expires_at = @expires_at, content_hash = @content_hash, updated_at = @updated_at
        WHERE id = @id
      `)
      .run({
        id,
        kind,
        title,
        content: storedContent,
        summary: patch.summary ?? existing.summary,
        tags: JSON.stringify(tags),
        sensitivity,
        status: patch.status ?? existing.status,
        confidence: patch.confidence ?? existing.confidence,
        importance: patch.importance ?? existing.importance,
        pinned: (patch.pinned ?? existing.pinned === 1) ? 1 : 0,
        expires_at: patch.expiresAt ?? existing.expires_at,
        content_hash: contentHash,
        updated_at: now,
      })

    const updated = ctx.getRaw(id)!
    ctx.syncFts(id, { ...rowToMemory(updated), content: plainContent }, sensitivity)
    ctx.bumpTags(tags, now)
    ctx.audit(actor, 'update', id, title)
  })()

  return ctx.hydrate(ctx.getRaw(id)!, true)
}
