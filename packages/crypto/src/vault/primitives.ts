/**
 * 密钥派生与封装的底层原语。
 *
 * DEK（数据密钥）真正用来加密内容，KEK（密钥加密密钥）只用来包住 DEK。
 * 这样换口令时只需重新封装 DEK，不必把所有密文重新加密一遍。
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { ALGO, BLOB_PREFIX, DEK_BYTES, IV_BYTES, SCRYPT } from './constants.js'
import type { KeyWrapper } from './types.js'

export function isEncryptedBlob(s: string): boolean {
  return s.startsWith(`${BLOB_PREFIX}:`)
}

export function deriveKek(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, DEK_BYTES, SCRYPT)
}

export function generateKek(): Buffer {
  return randomBytes(DEK_BYTES)
}

export function wrapDek(
  dek: Buffer,
  kek: Buffer,
  type: KeyWrapper['type'],
  salt?: Buffer,
  label?: string,
): KeyWrapper {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, kek, iv)
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()])
  return {
    id: randomBytes(8).toString('hex'),
    type,
    salt: salt?.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    wrapped: wrapped.toString('base64'),
    createdAt: Date.now(),
    label,
  }
}

export function tryUnwrap(w: KeyWrapper, kek: Buffer): Buffer | null {
  try {
    const decipher = createDecipheriv(ALGO, kek, Buffer.from(w.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(w.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(w.wrapped, 'base64')), decipher.final()])
  } catch {
    return null
  }
}

export function checksum(dek: Buffer): string {
  // 用固定 IV 加密固定串得到确定性校验值；只用于确认 DEK 是否正确，不泄露密钥
  const cipher = createCipheriv(ALGO, dek, Buffer.alloc(IV_BYTES))
  const ct = Buffer.concat([cipher.update('mycelia-dek-check', 'utf8'), cipher.final()])
  return Buffer.concat([ct, cipher.getAuthTag()]).toString('base64')
}

/** 常数时间比较，避免时序侧信道 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
