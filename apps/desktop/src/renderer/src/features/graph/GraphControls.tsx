/**
 * 图谱的浮层控件。
 *
 * 全部绝对定位在画布四角，画布本身占满剩余空间 ——
 * 图是这个视图的主角，控件不该挤占它的面积。
 */

import type { GraphSnapshot } from '@mycelia/shared'
import { type ReactNode, useEffect, useState } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { DEFAULT_EDGE_KINDS, EDGE_LABELS, KIND_LABELS, kindColor } from '../../shared/lib/labels.js'
import {
  Button,
  Chip,
  Icon,
  IconButton,
  KindDot,
  Segmented,
  Slider,
  Spinner,
  Tooltip,
} from '../../shared/ui/index.js'
import type { ColorMode } from './GraphCanvas.js'
import { clusterColor } from './graph-theme.js'

/** 顶部：边类型过滤、着色依据、重建关联 */
export function GraphToolbar({
  edgeKinds,
  onToggleEdgeKind,
  colorMode,
  onColorModeChange,
  onRebuild,
  rebuilding,
  onRelayout,
  search,
}: {
  edgeKinds: ReadonlySet<string>
  onToggleEdgeKind: (kind: string) => void
  colorMode: ColorMode
  onColorModeChange: (mode: ColorMode) => void
  onRebuild: () => void
  rebuilding: boolean
  /** 丢弃存下的坐标重新排布 */
  onRelayout: () => void
  /** 搜索框。放进工具栏的布局流里，不能各自绝对定位 —— 那样必定互相遮挡 */
  search?: ReactNode
}) {
  const [confirmRebuild, setConfirmRebuild] = useState(false)

  // 悬而未决的确认状态过几秒自动撤销，免得下次点进来时莫名其妙就执行了
  useEffect(() => {
    if (!confirmRebuild) return
    const timer = setTimeout(() => setConfirmRebuild(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmRebuild])

  return (
    <div className="absolute top-3 left-3 right-3 flex items-start gap-2 pointer-events-none">
      {/*
        必须有实心底。节点密起来之后会一直铺到画面顶端，
        透明的按钮组就沉在色块里认不出来了 —— 控件跟内容抢同一块像素，
        输的永远是控件。
      */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 p-1 pointer-events-auto',
          'bg-overlay/92 border border-border rounded-[9px] shadow-sm backdrop-blur-sm',
        )}
      >
        {Object.entries(EDGE_LABELS)
          .filter(([kind]) => DEFAULT_EDGE_KINDS.includes(kind as never))
          .map(([kind, label]) => (
            <Chip key={kind} active={edgeKinds.has(kind)} onClick={() => onToggleEdgeKind(kind)}>
              {label}
            </Chip>
          ))}
      </div>

      <div className="flex-1" />

      <div
        className={cn(
          'flex items-center gap-1.5 p-1 pointer-events-auto',
          'bg-overlay/92 border border-border rounded-[9px] shadow-sm backdrop-blur-sm',
        )}
      >
        {search}
        <Segmented<ColorMode>
          value={colorMode}
          onChange={onColorModeChange}
          options={[
            { value: 'kind', label: '按类型' },
            { value: 'cluster', label: '按簇' },
          ]}
        />
        {/*
          位置一旦存下来就不再变动，这是有意的（每次重排都会抹掉用户的方位感），
          但也得留个重来的出口 —— 布局排得不满意时总要能推倒重来。
        */}
        <Tooltip content="丢弃当前位置，重新排布">
          <IconButton label="重新布局" size="sm" onClick={onRelayout}>
            <Icon name="sync" size={13} />
          </IconButton>
        </Tooltip>

        {/*
          重建是破坏性的：它先 DELETE 掉全部自动关联（语义/标签/会话/实体）
          再重算。模型没配好或向量缺失时，重算结果可能是空的 —— 一次误触
          就把整张图的连接清光，且不可撤销。所以要二次确认。
        */}
        <Button
          size="sm"
          onClick={() => {
            if (!confirmRebuild) {
              setConfirmRebuild(true)
              return
            }
            setConfirmRebuild(false)
            onRebuild()
          }}
          disabled={rebuilding}
          variant={confirmRebuild ? 'danger' : undefined}
        >
          {rebuilding ? <Spinner /> : <Icon name="spark" size={13} />}
          {confirmRebuild ? '确认重建？' : '重建关联'}
        </Button>
      </div>
    </div>
  )
}

/** 左下：规模统计、孤立节点过滤、簇导航 */
export function GraphStatsPanel({
  snapshot,
  minDegree,
  onMinDegreeChange,
  colorMode,
  onFocusCluster,
}: {
  snapshot: GraphSnapshot
  minDegree: number
  onMinDegreeChange: (value: number) => void
  colorMode: ColorMode
  onFocusCluster: (cluster: number) => void
}) {
  // 与画布上着色/画轮廓的口径保持一致：只列主要的簇。
  // 列表里列了二十个而图上只圈了十个，用户会以为图画漏了
  const clusters = snapshot.clusters
    .filter((cluster) => cluster.size >= 4)
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
  const isDark = document.documentElement.dataset.theme === 'dark'

  // 拖动中的值。图的重排等松手再做，拖动过程只更新这个数字
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? minDegree

  return (
    <div
      className={cn(
        'absolute bottom-3 left-3 flex flex-col gap-2 w-[186px] p-2.5',
        'bg-overlay/92 border border-border rounded-[9px] shadow-sm backdrop-blur-sm',
      )}
    >
      {/*
        两个数都必须取自当前这份快照。早先记忆数读的是 stats.memoryCount
        （过滤前的统计），关联数读的是过滤后的数组 —— 调高「最少连接数」后
        画面上明明少了一大片节点，记忆数却纹丝不动，只有关联数在掉。
      */}
      <div className="flex items-center gap-3 text-[11px] text-muted tabular">
        <span>{snapshot.nodes.length} 记忆</span>
        <span>{snapshot.edges.length} 关联</span>
      </div>

      {/* 真实知识库里总有一批还没长出关联的孤立节点，在画面边缘铺成噪点 */}
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-[10.5px] text-faint">
          最少连接数
          <span className={cn('tabular', shown > 0 && 'text-text font-medium')}>{shown}</span>
        </span>
        <Slider
          label="最少连接数"
          value={shown}
          min={0}
          max={6}
          // 拖动只改数字，松手才真正过滤 —— 每个中间值都重排整张图会卡成幻灯片
          onChange={setDraft}
          onCommit={(value) => {
            setDraft(null)
            onMinDegreeChange(value)
          }}
        />
        {shown > 0 && (
          <span className="text-[10px] text-faint leading-snug">只看连接数 ≥ {shown} 的节点</span>
        )}
      </div>

      {clusters.length > 0 && colorMode === 'cluster' && (
        <div className="flex flex-col gap-0.5 pt-1.5 border-t border-border max-h-[150px] overflow-y-auto">
          {clusters.map((cluster) => (
            <button
              key={cluster.id}
              type="button"
              onClick={() => onFocusCluster(cluster.id)}
              className="flex items-center gap-1.5 px-1 h-[21px] rounded-[5px] hover:bg-hover text-left transition-colors"
            >
              <span
                className="size-[6px] rounded-full shrink-0"
                style={{ background: clusterColor(cluster.id, isDark) }}
              />
              <span className="text-[11px] truncate flex-1">{cluster.label}</span>
              <span className="text-[10px] text-faint tabular">{cluster.size}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 右下：缩放与回到全图 */
export function GraphZoomControls({
  onZoom,
  onReset,
}: {
  onZoom: (direction: 1 | -1) => void
  onReset: () => void
}) {
  const style = 'bg-overlay/92 border border-border backdrop-blur-sm'
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1">
      <IconButton label="放大" size="sm" className={style} onClick={() => onZoom(1)}>
        <Icon name="plus" size={14} />
      </IconButton>
      <IconButton label="缩小" size="sm" className={style} onClick={() => onZoom(-1)}>
        <span className="text-[15px] leading-none">−</span>
      </IconButton>
      <IconButton label="回到全图" size="sm" className={style} onClick={onReset}>
        <Icon name="home" size={13} />
      </IconButton>
    </div>
  )
}

/** 悬停提示。贴在画布顶部居中，不跟随鼠标 —— 跟随会遮住正在看的节点 */
export function GraphHoverCard({
  node,
}: {
  node: { label: string; kind: string; degree: number }
}) {
  return (
    <div
      className={cn(
        'absolute top-14 left-1/2 -translate-x-1/2 flex items-center gap-2',
        'px-2.5 py-1.5 bg-overlay/94 border border-border rounded-[7px]',
        'shadow-sm backdrop-blur-sm animate-fade-in pointer-events-none max-w-[420px]',
      )}
    >
      <KindDot color={kindColor(node.kind)} />
      <span className="text-[12px] truncate">{node.label}</span>
      <span className="text-[10.5px] text-faint shrink-0">
        {KIND_LABELS[node.kind] ?? node.kind} · {node.degree} 连接
      </span>
    </div>
  )
}
