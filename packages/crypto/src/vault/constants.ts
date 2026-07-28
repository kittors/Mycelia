/**
 * 加密参数。
 *
 * 这些值一旦发布就不能随意改 —— 改了会导致已有保险箱无法解开。
 * 真要升级参数，得走带版本号的迁移路径。
 */

export const ALGO = 'aes-256-gcm'
export const DEK_BYTES = 32
export const IV_BYTES = 12
export const SALT_BYTES = 16
export const BLOB_PREFIX = 'myc1'

/** scrypt 参数：N=2^15 在现代机器上约 100ms，足以拖垮离线爆破又不影响体验 */
export const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
