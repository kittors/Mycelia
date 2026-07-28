import { type FormEvent, useState } from 'react'
import { useAsync } from '../../shared/hooks/useAsync.js'
import { cn } from '../../shared/lib/cn.js'
import { Button, Field, Icon, Input } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'

export function VaultView() {
  const revision = useApp((s) => s.revision)
  const app = useApp()
  const secretCount = useApp((s) => s.dashboard?.vault.secretCount ?? 0)

  const { data: status, reload } = useAsync(() => window.mycelia.vaultStatus(), [revision])
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (status?.initialized) {
        await window.mycelia.vaultUnlock(passphrase)
        app.toast('保险箱已解锁', 'success')
      } else {
        await window.mycelia.vaultInit(passphrase)
        app.toast('保险箱已创建', 'success')
      }
      setPassphrase('')
      reload()
      app.bump()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const unlocked = status?.unlocked ?? false

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[540px] px-5 py-6">
        <div
          className={cn(
            'flex items-start gap-3.5 p-4 rounded-[10px] border',
            unlocked ? 'border-success/30 bg-success/[0.04]' : 'border-border bg-surface',
          )}
        >
          <div
            className={cn(
              'flex items-center justify-center size-9 rounded-[9px] shrink-0',
              unlocked ? 'bg-success/12 text-success' : 'bg-hover text-muted',
            )}
          >
            <Icon name={unlocked ? 'unlock' : 'lock'} size={17} />
          </div>

          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <h2 className="text-[13.5px] font-medium">
              {unlocked ? '保险箱已解锁' : status?.initialized ? '保险箱已锁定' : '尚未创建保险箱'}
            </h2>
            <p className="text-[12px] text-faint leading-relaxed">
              {unlocked
                ? `${secretCount} 条加密记忆在本次会话中可读。应用退出时自动上锁。`
                : status?.initialized
                  ? '凭据类记忆以密文存放，解锁后才能读取正文。口令本身不会被保存。'
                  : '创建一个独立口令。凭据与 secret 记忆会用它派生的密钥加密落盘。'}
            </p>

            {unlocked ? (
              <div className="flex gap-1.5 mt-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await window.mycelia.vaultEnableKeychain()
                      app.toast('已启用系统钥匙串免密解锁', 'success')
                      reload()
                    } catch (cause) {
                      app.fail(cause)
                    }
                  }}
                >
                  启用系统钥匙串
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await window.mycelia.vaultLock()
                    app.toast('已上锁')
                    reload()
                    app.bump()
                  }}
                >
                  立即上锁
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-2 mt-2.5">
                <Field
                  label={status?.initialized ? '口令' : '新口令'}
                  hint={status?.initialized ? undefined : '至少 12 个字符，丢失无法找回'}
                  error={error}
                >
                  <Input
                    type="password"
                    autoFocus
                    minLength={12}
                    value={passphrase}
                    onChange={(event) => setPassphrase(event.target.value)}
                    placeholder={status?.initialized ? '输入口令解锁' : '设置一个足够长的口令'}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="self-start"
                  disabled={busy || passphrase.length < (status?.initialized ? 1 : 12)}
                >
                  {busy ? '处理中…' : status?.initialized ? '解锁' : '创建保险箱'}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6">
          <Fact
            icon="database"
            title="AES-256-GCM，密文落盘"
            description="明文只存在于解锁后的进程内存里，数据库文件被拷走也读不出内容。"
          />
          <Fact
            icon="agent"
            title="MCP 默认不返回 secret"
            description="agent 检索到加密记忆时只能看到标题，正文需要显式授权。"
          />
          <Fact
            icon="lock"
            title="凭据类型强制加密"
            description="即使写入方把敏感度标成 public，credential 类型仍会被提升为 secret。"
          />
        </div>
      </div>
    </div>
  )
}

function Fact({
  icon,
  title,
  description,
}: {
  icon: 'database' | 'agent' | 'lock'
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icon} size={15} className="text-faint mt-[2px] shrink-0" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px]">{title}</span>
        <span className="text-[11.5px] text-faint leading-relaxed">{description}</span>
      </div>
    </div>
  )
}
