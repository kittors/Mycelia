import { useState } from 'react'
import type { AgentIntegrationView } from '../../../../shared/ipc-contract.js'
import { useAsync } from '../../shared/hooks/useAsync.js'
import { useDelayedFlag } from '../../shared/hooks/useDelayedFlag.js'
import { cn } from '../../shared/lib/cn.js'
import { truncatePath } from '../../shared/lib/format.js'
import { agentName } from '../../shared/lib/labels.js'
import { AgentIcon } from '../../shared/ui/AgentIcon.js'
import { Badge, Empty, Icon, SkeletonRow, Spinner, Toggle } from '../../shared/ui/index.js'
import { useApp } from '../../store/app-store.js'
import { PaneSection } from '../components.js'

/**
 * Agent 接入。
 *
 * 每行一个 agent：品牌标识、名称、探测到的状态、右侧开关。
 * 展开后是接入细节（配置文件位置、CLI 路径、版本、skill 状态）——
 * 默认收起，因为绝大多数时候用户只想看「接上没有」这一件事。
 */
export function AgentsPane() {
  const revision = useApp((s) => s.revision)
  const { data, loading, reload } = useAsync(() => window.mycelia.getIntegrations(), [revision])

  const agents = data ?? []
  const connected = agents.filter((item) => item.installed).length
  const available = agents.filter((item) => item.agentPresent).length

  // 探测通常几十毫秒就回来，太快时不必让骨架闪一下
  const empty = agents.length === 0
  const showSkeleton = useDelayedFlag(loading && empty)

  return (
    <div className="px-5 py-5 max-w-[640px]">
      <PaneSection
        title="本机 Agent"
        hint={
          loading && empty
            ? showSkeleton
              ? '正在探测…'
              : ''
            : `检测到 ${available} 个，已接入 ${connected} 个`
        }
      >
        <div className="flex flex-col divide-y divide-border border border-border rounded-[10px] overflow-hidden">
          {loading && empty && (
            // 骨架保持行结构占位，内容到达时高度不变，不会有跳动
            <div className={cn('flex flex-col', showSkeleton ? 'animate-fade-in' : 'invisible')}>
              {Array.from({ length: 4 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架没有稳定标识
                <div key={index} className="border-b border-border last:border-0">
                  <SkeletonRow index={index} trailing="switch" />
                </div>
              ))}
            </div>
          )}

          {!loading && empty && (
            <Empty
              icon={<Icon name="agent" size={24} />}
              title="没有检测到 agent"
              description="安装 Claude Code、Codex、opencode 或 pi 之后回到这里，它们会自动出现。"
            />
          )}

          {agents.map((item, index) => (
            <div
              key={item.agent}
              className="stagger"
              // 逐行浮现，比整块内容同时弹出更自然
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <AgentRow item={item} onChanged={reload} />
            </div>
          ))}
        </div>
      </PaneSection>

      <p className="mt-4 text-[11.5px] text-faint leading-relaxed">
        接入会做两件事：注册 MCP server 让 agent
        <b className="font-medium text-muted">能</b>读写记忆，安装 skill 让它
        <b className="font-medium text-muted">记得</b>在合适的时机去用。 改动需要重启对应的 agent
        才生效。
      </p>
    </div>
  )
}

function AgentRow({ item, onChanged }: { item: AgentIntegrationView; onChanged: () => void }) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      if (item.installed) {
        await window.mycelia.uninstallIntegration(item.agent)
        app.toast(`已断开 ${agentName(item.agent)}`)
      } else {
        await window.mycelia.installIntegration(item.agent)
        app.toast(`${agentName(item.agent)} 已接入，重启后生效`, 'success')
      }
      onChanged()
      app.bump()
    } catch (error) {
      app.fail(error)
    } finally {
      setBusy(false)
    }
  }

  const status = describeStatus(item)

  return (
    <div className="bg-surface">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          type="button"
          aria-label={expanded ? '收起详情' : '展开详情'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            'flex items-center justify-center size-5 shrink-0 rounded-[4px]',
            'text-faint hover:text-text hover:bg-hover transition-colors',
          )}
        >
          <Icon
            name="chevron"
            size={12}
            className={cn('transition-transform duration-200', expanded && 'rotate-90')}
          />
        </button>

        <AgentIcon
          agent={item.agent}
          size={18}
          className={cn('shrink-0', item.agentPresent ? 'text-text' : 'text-faint')}
        />

        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={cn('text-[13px]', !item.agentPresent && 'text-muted')}>
            {agentName(item.agent)}
          </span>
          <span className="text-faint text-[11px]">·</span>
          <span className={cn('size-[6px] rounded-full shrink-0', status.dot)} aria-hidden="true" />
          <span className="text-[11.5px] text-muted truncate">{status.label}</span>
          {item.version && (
            <span className="text-[11px] text-faint tabular shrink-0">{item.version}</span>
          )}
        </div>

        {busy ? (
          <Spinner className="text-faint shrink-0" />
        ) : (
          <Toggle
            checked={item.installed}
            disabled={!item.agentPresent}
            label={`${item.installed ? '断开' : '接入'} ${agentName(item.agent)}`}
            onChange={toggle}
          />
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-1.5 px-3 pb-3 pl-[52px] animate-fade-in">
          <Detail label="MCP 配置" value={item.configPath} path />
          {item.cliPath && <Detail label="CLI" value={item.cliPath} path />}
          <Detail
            label="Skill"
            value={
              item.skillSupported
                ? item.skillInstalled
                  ? '已安装'
                  : '未安装'
                : '该 agent 没有 skill 机制，仅靠 MCP 工具描述'
            }
          />
          {item.installed && item.skillSupported && !item.skillInstalled && (
            <Badge tone="warning">MCP 已接但 skill 缺失，重新接入一次可补上</Badge>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, path }: { label: string; value: string; path?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-[11.5px]">
      <span className="text-faint w-[64px] shrink-0">{label}</span>
      <span
        className={cn('text-muted truncate min-w-0', path && 'font-[var(--font-mono)] text-[11px]')}
        title={value}
        data-selectable
      >
        {path ? truncatePath(value, 52) : value}
      </span>
    </div>
  )
}

/**
 * 状态文案。
 *
 * 「装了但没接」和「压根没装」需要用户做的事完全不同，
 * 所以这两种情况必须区分开，不能都显示成「未启用」。
 */
function describeStatus(item: AgentIntegrationView): { label: string; dot: string } {
  if (!item.agentPresent) return { label: '未检测到', dot: 'bg-border-strong' }
  if (item.installed) {
    return item.skillSupported && !item.skillInstalled
      ? { label: '已接入（缺 skill）', dot: 'bg-warning' }
      : { label: '已接入', dot: 'bg-success' }
  }
  if (!item.configDirExists) return { label: '已安装，尚未运行过', dot: 'bg-warning' }
  return { label: '可用', dot: 'bg-warning' }
}
