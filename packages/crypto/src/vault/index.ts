/**
 * 加密保险箱。
 *
 * 落盘格式（记忆正文里存的就是这个字符串）：
 *   myc1:<base64 iv>:<base64 authTag>:<base64 ciphertext>
 *
 * GCM 的 authTag 让篡改无法被静默忽略 —— 解密失败会抛错而不是返回垃圾。
 *
 * 密钥分两层：DEK 加密内容，KEK 包裹 DEK。同一个 DEK 可以被多把 KEK 包裹
 * （口令一把、系统钥匙串一把），换口令时只重新包裹，不动任何密文。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MyceliaError } from '@mycelia/shared'
import { ALGO, BLOB_PREFIX, DEK_BYTES, IV_BYTES, SALT_BYTES } from './constants.js'
import { checksum, deriveKek, tryUnwrap, wrapDek } from './primitives.js'
import type { KeyWrapper, VaultFile, VaultStatus } from './types.js'

export { deriveKek, generateKek, isEncryptedBlob, safeEqual } from './primitives.js'
export type { VaultStatus } from './types.js'

/**
 * 保险箱本体。
 *
 * 未解锁时 dek 为 null，任何加解密调用都会明确失败而不是静默降级 ——
 * 「保险箱没开却把密钥存成了明文」是这里最不能出的错。
 */
export class Vault {
  private readonly filePath: string
  private file: VaultFile | null = null
  private dek: Buffer | null = null
  /** 自动上锁定时器 */
  private lockTimer: NodeJS.Timeout | null = null
  private autoLockMs = 15 * 60 * 1000

  constructor(filePath: string) {
    this.filePath = filePath
    this.load()
  }

  private load() {
    if (!existsSync(this.filePath)) return
    try {
      this.file = JSON.parse(readFileSync(this.filePath, 'utf8')) as VaultFile
    } catch (e) {
      throw new MyceliaError('vault_corrupt', `保险箱文件损坏：${this.filePath}`, e)
    }
  }

  private persist() {
    if (!this.file) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.file, null, 2), { mode: 0o600 })
    // Windows 上 chmod 基本是空操作，但在 POSIX 上这一行是必要的
    try {
      chmodSync(this.filePath, 0o600)
    } catch {
      /* Windows 无 POSIX 权限位，忽略 */
    }
  }

  get initialized(): boolean {
    return this.file !== null
  }

  get unlocked(): boolean {
    return this.dek !== null
  }

  status(): VaultStatus {
    return {
      initialized: this.initialized,
      unlocked: this.unlocked,
      wrappers: (this.file?.wrappers ?? []).map((w) => ({
        id: w.id,
        type: w.type,
        label: w.label,
        createdAt: w.createdAt,
      })),
    }
  }

  /** 首次初始化：生成 DEK 并用给定的 KEK 包裹 */
  init(kek: Buffer, type: KeyWrapper['type'], label?: string, salt?: Buffer): void {
    if (this.file) throw new MyceliaError('vault_exists', '保险箱已初始化')
    const dek = randomBytes(DEK_BYTES)
    const wrapper = wrapDek(dek, kek, type, salt, label)
    this.file = {
      version: 1,
      dekCheck: checksum(dek),
      wrappers: [wrapper],
      createdAt: Date.now(),
    }
    this.persist()
    this.setDek(dek)
  }

  /** 用口令初始化 */
  initWithPassphrase(passphrase: string): void {
    const salt = randomBytes(SALT_BYTES)
    const kek = deriveKek(passphrase, salt)
    this.init(kek, 'passphrase', '口令', salt)
  }

  /** 用系统钥匙串提供的随机密钥初始化（Electron safeStorage 场景） */
  initWithKey(kek: Buffer, label = '系统钥匙串'): void {
    this.init(kek, 'keychain', label)
  }

  unlockWithPassphrase(passphrase: string): void {
    const file = this.requireFile()
    for (const w of file.wrappers) {
      if (w.type !== 'passphrase' || !w.salt) continue
      const kek = deriveKek(passphrase, Buffer.from(w.salt, 'base64'))
      const dek = tryUnwrap(w, kek)
      if (dek && checksum(dek) === file.dekCheck) {
        this.setDek(dek)
        return
      }
    }
    throw new MyceliaError('bad_passphrase', '口令错误')
  }

  unlockWithKey(kek: Buffer): void {
    const file = this.requireFile()
    for (const w of file.wrappers) {
      if (w.type !== 'keychain') continue
      const dek = tryUnwrap(w, kek)
      if (dek && checksum(dek) === file.dekCheck) {
        this.setDek(dek)
        return
      }
    }
    throw new MyceliaError('bad_key', '钥匙串密钥无法解锁保险箱')
  }

  /**
   * 追加一把新钥匙。
   * 典型场景：用户先在 CLI 用口令建了库，之后装了桌面端，
   * 桌面端解锁一次后把 keychain KEK 追加进来，此后免密。
   */
  addKeyWrapper(kek: Buffer, type: KeyWrapper['type'], label?: string, salt?: Buffer): void {
    const file = this.requireFile()
    const dek = this.requireDek()
    file.wrappers.push(wrapDek(dek, kek, type, salt, label))
    this.persist()
  }

  addPassphrase(passphrase: string, label = '口令'): void {
    const salt = randomBytes(SALT_BYTES)
    this.addKeyWrapper(deriveKek(passphrase, salt), 'passphrase', label, salt)
  }

  removeWrapper(id: string): void {
    const file = this.requireFile()
    if (file.wrappers.length <= 1) {
      throw new MyceliaError('last_key', '这是最后一把钥匙，删掉就再也打不开了')
    }
    file.wrappers = file.wrappers.filter((w) => w.id !== id)
    this.persist()
  }

  lock(): void {
    if (this.dek) this.dek.fill(0)
    this.dek = null
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
  }

  setAutoLock(ms: number): void {
    this.autoLockMs = ms
    if (this.dek) this.armAutoLock()
  }

  encrypt(plaintext: string): string {
    const dek = this.requireDek()
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGO, dek, iv)
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [BLOB_PREFIX, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(
      ':',
    )
  }

  decrypt(blob: string): string {
    const dek = this.requireDek()
    const parts = blob.split(':')
    if (parts.length !== 4 || parts[0] !== BLOB_PREFIX) {
      throw new MyceliaError('bad_blob', '密文格式不合法')
    }
    const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string]
    const decipher = createDecipheriv(ALGO, dek, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      throw new MyceliaError('decrypt_failed', '解密失败：密文被篡改或密钥不匹配')
    }
  }

  private setDek(dek: Buffer) {
    this.dek = dek
    this.armAutoLock()
  }

  private armAutoLock() {
    if (this.lockTimer) clearTimeout(this.lockTimer)
    if (this.autoLockMs <= 0) return
    this.lockTimer = setTimeout(() => this.lock(), this.autoLockMs)
    this.lockTimer.unref?.()
  }

  private requireFile(): VaultFile {
    if (!this.file) throw new MyceliaError('vault_uninitialized', '保险箱尚未初始化')
    return this.file
  }

  private requireDek(): Buffer {
    if (!this.dek) throw new MyceliaError('vault_locked', '保险箱已上锁')
    return this.dek
  }
}
