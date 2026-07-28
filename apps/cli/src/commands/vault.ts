import type { MemoryService } from '@mycelia/core'
import { c, confirm, fail, header, kv, line, prompt, success, warn } from '../ui.js'

/**
 * 保险箱命令。
 *
 * 注意这里的取舍：解锁状态无法跨进程共享（DEK 只在内存里）。
 * 所以 `myc vault unlock` 单独跑没有意义 —— 进程一退出就锁上了。
 * 它的真实用途是配合 `--unlock` 参数在同一条命令里临时解锁，
 * 或者在桌面端解锁后由桌面端进程持有。这一点必须对用户说清楚。
 */
export async function vaultCommand(
  service: MemoryService,
  action: string | undefined,
  opts: { passphrase?: string },
): Promise<void> {
  const vault = service.store.vault

  switch (action ?? 'status') {
    case 'status': {
      const status = vault.status()
      header('保险箱')
      kv(
        '状态',
        status.initialized
          ? status.unlocked
            ? c.green('已解锁')
            : c.gray('已上锁')
          : c.yellow('未初始化'),
      )
      if (status.initialized) {
        kv('钥匙', String(status.wrappers.length))
        for (const w of status.wrappers) {
          line(
            `    ${c.gray('·')} ${w.label ?? w.type} ${c.gray(`(${w.type}, ${new Date(w.createdAt).toLocaleDateString('zh-CN')})`)}`,
          )
        }
      }
      const secretCount = service.store.memories.count({ sensitivity: ['secret'] })
      kv('加密记忆', `${secretCount} 条`)
      if (!status.initialized) {
        line('')
        line(c.gray('  跑 `myc vault init` 初始化后才能保存凭据类记忆。'))
      }
      line('')
      break
    }

    case 'init': {
      if (vault.initialized) {
        warn('保险箱已初始化')
        return
      }
      line(c.gray('  设置保险箱口令。它用于加密 SSH 密钥、API Key 等敏感记忆。'))
      line(c.yellow('  口令无法找回 —— 忘记就等于永久丢失这些记忆。'))
      line('')
      const p1 = opts.passphrase ?? (await prompt('设置口令：', { silent: true }))
      if (p1.length < 8) {
        fail('口令至少 8 个字符')
        process.exitCode = 1
        return
      }
      if (!opts.passphrase) {
        const p2 = await prompt('再输一次：', { silent: true })
        if (p1 !== p2) {
          fail('两次输入不一致')
          process.exitCode = 1
          return
        }
      }
      vault.initWithPassphrase(p1)
      success('保险箱已创建并解锁')
      line(c.gray('  桌面端首次解锁后会自动追加系统钥匙串，之后免密使用。'))
      break
    }

    case 'unlock': {
      if (!vault.initialized) {
        fail('保险箱尚未初始化，先跑 `myc vault init`')
        process.exitCode = 1
        return
      }
      const p = opts.passphrase ?? (await prompt('口令：', { silent: true }))
      try {
        vault.unlockWithPassphrase(p)
        success('已解锁')
        line(c.gray('  注意：解锁状态只存在于当前进程。命令结束后自动上锁。'))
        line(c.gray('  要长期解锁，请使用桌面端，或在同一条命令里加 --unlock。'))
      } catch (e) {
        fail(String(e instanceof Error ? e.message : e))
        process.exitCode = 1
      }
      break
    }

    case 'passwd': {
      if (!vault.initialized) {
        fail('保险箱尚未初始化')
        process.exitCode = 1
        return
      }
      const current = await prompt('当前口令：', { silent: true })
      vault.unlockWithPassphrase(current)
      const next = await prompt('新口令：', { silent: true })
      if (next.length < 8) {
        fail('口令至少 8 个字符')
        process.exitCode = 1
        return
      }
      const confirmPass = await prompt('再输一次：', { silent: true })
      if (next !== confirmPass) {
        fail('两次输入不一致')
        process.exitCode = 1
        return
      }
      // 信封加密的好处：换口令只是重新包裹 DEK，不需要重新加密任何记忆
      vault.addPassphrase(next, '口令')
      const old = vault.status().wrappers.find((w) => w.type === 'passphrase')
      if (old) vault.removeWrapper(old.id)
      success('口令已更新')
      break
    }

    case 'list': {
      if (!vault.unlocked) {
        const p = opts.passphrase ?? (await prompt('口令：', { silent: true }))
        vault.unlockWithPassphrase(p)
      }
      const secrets = service.store.memories.list({ sensitivity: ['secret'], limit: 100 })
      header(`加密记忆 ${c.gray(`(${secrets.length})`)}`)
      for (const m of secrets) {
        line(`  ${c.red('🔒')} ${m.title} ${c.gray(m.tags.join(' '))}`)
        line(`     ${c.gray(m.id)}`)
      }
      line('')
      break
    }

    case 'lock':
      vault.lock()
      success('已上锁')
      break

    default:
      fail(`未知子命令：${action}。可用：status / init / unlock / lock / passwd / list`)
      process.exitCode = 1
  }
}

/** 在需要时按需解锁 —— 供带 --unlock 的命令调用 */
export async function ensureUnlocked(
  service: MemoryService,
  passphrase?: string,
): Promise<boolean> {
  const vault = service.store.vault
  if (!vault.initialized) {
    warn('保险箱未初始化，敏感记忆不可用')
    return false
  }
  if (vault.unlocked) return true

  const p = passphrase ?? (await prompt('保险箱口令：', { silent: true }))
  try {
    vault.unlockWithPassphrase(p)
    return true
  } catch {
    fail('口令错误')
    return false
  }
}

export { confirm }
