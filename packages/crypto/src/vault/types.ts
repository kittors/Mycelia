/** 保险箱的持久化结构 */

/**
 * 密钥包裹记录。
 * 同一个 DEK 可以被多把 KEK 包裹：
 *   - passphrase 包裹：CLI / 任意环境下用口令解锁
 *   - keychain 包裹：桌面端由 Electron safeStorage 提供 KEK，免密解锁
 * 换口令时只需重新包裹 DEK，不必重新加密任何一条记忆。
 */
interface KeyWrapper {
  id: string
  type: 'passphrase' | 'keychain'
  /** passphrase 类型专用 */
  salt?: string
  iv: string
  tag: string
  /** 被包裹的 DEK 密文 */
  wrapped: string
  createdAt: number
  label?: string
}

interface VaultFile {
  version: 1
  /** DEK 的校验值，用于在解开包裹后确认密钥正确 */
  dekCheck: string
  wrappers: KeyWrapper[]
  createdAt: number
}

export interface VaultStatus {
  initialized: boolean
  unlocked: boolean
  wrappers: Array<{ id: string; type: string; label?: string; createdAt: number }>
}

export type { KeyWrapper, VaultFile }
