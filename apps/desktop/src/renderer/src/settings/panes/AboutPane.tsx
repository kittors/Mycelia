import { useAsync } from '../../shared/hooks/useAsync.js'
import { Icon, Skeleton } from '../../shared/ui/index.js'
import { PaneIntro, PaneSection } from '../components.js'

export function AboutPane() {
  const { data: platform } = useAsync(() => window.mycelia.getPlatform(), [])
  const { data: dashboard } = useAsync(() => window.mycelia.getDashboard(), [])

  return (
    <div className="px-5 py-5 max-w-[560px]">
      <PaneIntro>
        连接所有 agent 的地下菌丝网络。换工具、换模型，知识都留在本机 ——
        记忆、文档、知识图谱三层，全部离线可用。
      </PaneIntro>

      <PaneSection title="运行信息">
        <dl className="flex flex-col divide-y divide-border border border-border rounded-[10px] px-3 text-[12.5px]">
          <Row label="版本" value={platform?.version} />
          <Row label="平台" value={platform?.platform} />
          <Row label="数据目录" value={platform?.dataDir} openPath={platform?.dataDir} />
          <Row label="嵌入模型" value={dashboard?.models.embedder.id} />
          <Row
            label="文本模型"
            value={
              dashboard
                ? dashboard.models.llm.enabled
                  ? dashboard.models.llm.model
                  : '未启用（规则降级）'
                : undefined
            }
          />
        </dl>
      </PaneSection>

      <PaneSection title="知识库规模" className="mt-6">
        <dl className="flex flex-col divide-y divide-border border border-border rounded-[10px] px-3 text-[12.5px]">
          <Row label="记忆" value={dashboard ? `${dashboard.stats.total} 条` : undefined} />
          <Row
            label="文档片段"
            value={dashboard ? `${dashboard.knowledge.chunks} 个` : undefined}
          />
          <Row
            label="挂载目录"
            value={dashboard ? `${dashboard.knowledge.sources} 个` : undefined}
          />
        </dl>
      </PaneSection>
    </div>
  )
}

/**
 * 数据未到时显示骨架而不是空白。
 *
 * 这一页全是异步取来的值，原本 data 为空时整页只剩几个标签，
 * 看起来像加载失败 —— 而它其实只是还没回来。
 */
function Row({ label, value, openPath }: { label: string; value?: string; openPath?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-faint shrink-0">{label}</dt>
      <dd className="flex items-center gap-1.5 min-w-0">
        {value === undefined ? (
          <Skeleton className="h-[9px] w-[120px] rounded-full" />
        ) : (
          <span className="truncate" data-selectable title={value}>
            {value}
          </span>
        )}
        {openPath && (
          <button
            type="button"
            aria-label="在访达中打开"
            className="text-faint hover:text-text transition-colors shrink-0"
            onClick={() => void window.mycelia.openPath(openPath)}
          >
            <Icon name="external" size={12} />
          </button>
        )}
      </dd>
    </div>
  )
}
