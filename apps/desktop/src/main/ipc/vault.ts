/**
 * 保险箱：口令解锁与系统钥匙串免密解锁。
 */

import type { MemoryService } from '@mycelia/core'
import { generateKek } from '@mycelia/crypto'
import { dataDir } from '@mycelia/shared'
import { safeStorage } from 'electron'
import { broadcast, type Handle } from './registry.js'

/** 系统钥匙串里存放 KEK 的文件名（内容由 safeStorage 加密） */
const KEYCHAIN_FILE = 'keychain.bin'

export function registerVaultHandlers(handle: Handle, service: MemoryService): void {
  // ─────────────────────── 保险箱 ───────────────────────

  handle('vaultStatus', () => ({
    ...service.store.vault.status(),
    // 系统钥匙串是否可用，决定设置页要不要显示「免密解锁」开关
    keychainAvailable: safeStorage.isEncryptionAvailable(),
  }))

  handle('vaultInit', (passphrase: string) => {
    service.store.vault.initWithPassphrase(passphrase)
    broadcast({ type: 'vault:changed', unlocked: true })
    return true
  })

  handle('vaultUnlock', (passphrase: string) => {
    service.store.vault.unlockWithPassphrase(passphrase)
    broadcast({ type: 'vault:changed', unlocked: true })
    return true
  })

  handle('vaultLock', () => {
    service.store.vault.lock()
    broadcast({ type: 'vault:changed', unlocked: false })
  })

  /**
   * 系统钥匙串免密解锁。
   *
   * safeStorage 把一段随机 KEK 加密后存成文件，密文只有本机当前用户能解开
   * （macOS 走 Keychain，Windows 走 DPAPI，Linux 走 libsecret）。
   * 这个 KEK 是保险箱的第二把钥匙 —— 口令那把依然有效，
   * 换机器或钥匙串失效时用口令还能开。
   */
  handle('vaultEnableKeychain', async () => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持安全存储（Linux 需要 libsecret / gnome-keyring）')
    }
    if (!service.store.vault.unlocked) {
      throw new Error('请先用口令解锁保险箱')
    }
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')

    const kek = generateKek()
    service.store.vault.addKeyWrapper(kek, 'keychain', '系统钥匙串')
    writeFileSync(
      join(dataDir(), KEYCHAIN_FILE),
      safeStorage.encryptString(kek.toString('base64')),
      {
        mode: 0o600,
      },
    )
    return true
  })

  handle('vaultUnlockWithKeychain', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = join(dataDir(), KEYCHAIN_FILE)
    if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return false

    const kek = Buffer.from(safeStorage.decryptString(readFileSync(file)), 'base64')
    service.store.vault.unlockWithKey(kek)
    broadcast({ type: 'vault:changed', unlocked: true })
    return true
  })
}
