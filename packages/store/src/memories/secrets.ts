/**
 * secret 记忆的加解密边界。
 *
 * 上层拿到的永远是「能直接用的 Memory」：保险箱锁着时是占位符 + locked 标记，
 * 而不是一坨密文。加解密只在这一个文件里发生。
 */

import { isEncryptedBlob, type Vault } from '@mycelia/crypto'
import { SECRET_PLACEHOLDER } from '@mycelia/shared'
import { type MemoryRow, rowToMemory, type StoredMemory } from '../rows.js'

/**
 * 写入前加密。
 *
 * 保险箱没解锁却要写 secret 时直接抛错，而不是静默存成明文 ——
 * 这是安全底线，宁可写入失败也不能把密钥落成明文。
 */
export function encryptContent(vault: Vault | null, content: string, sensitivity: string): string {
  if (sensitivity !== 'secret') return content
  if (!vault?.unlocked) throw new Error('保险箱未解锁，无法写入 secret 记忆')
  return vault.encrypt(content)
}

export function decryptContent(
  vault: Vault | null,
  stored: string,
): { text: string; locked: boolean } {
  if (!isEncryptedBlob(stored)) return { text: stored, locked: false }
  if (!vault?.unlocked) return { text: SECRET_PLACEHOLDER, locked: true }
  try {
    return { text: vault.decrypt(stored), locked: false }
  } catch {
    return { text: SECRET_PLACEHOLDER, locked: true }
  }
}

/** 数据库行 → 领域对象，按需解密 */
export function hydrateRow(vault: Vault | null, row: MemoryRow, decrypt: boolean): StoredMemory {
  const memory = rowToMemory(row)
  if (!isEncryptedBlob(row.content)) return memory
  if (!decrypt) return { ...memory, content: SECRET_PLACEHOLDER, locked: true }
  const { text, locked } = decryptContent(vault, row.content)
  return { ...memory, content: text, locked }
}
