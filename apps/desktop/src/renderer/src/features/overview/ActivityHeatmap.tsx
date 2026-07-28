import { useMemo } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { KIND_LABELS } from '../../shared/lib/labels.js'
import { Tooltip } from '../../shared/ui/index.js'

export interface ActivityDay {
  /** 本地时区的 YYYY-MM-DD */
  date: string
  count: number
  byKind: Record<string, number>
}

const CELL = 12
const GAP = 3
const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '日']

/**
 * 强度分档。
 *
 * 用绝对阈值而不是「除以最大值」：个人知识库里偶尔会有一天集中整理出几十条，
 * 按最大值归一化的话，那一天会把其余所有日子压成同一个色阶，图就没信息量了。
 */
function level(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

/** 中性色阶，跟着主题走 —— 不用 GitHub 那种固定绿 */
const LEVEL_CLASS: Record<number, string> = {
  0: 'bg-hover',
  1: 'bg-accent/20',
  2: 'bg-accent/40',
  3: 'bg-accent/65',
  4: 'bg-accent/90',
}

/**
 * 贡献热力图。
 *
 * 竖着一列是一周（周一在上），横着走是时间推移 —— 和 GitHub 一致，
 * 这个布局大家已经认得，不必再学。
 */
export function ActivityHeatmap({ days }: { days: ActivityDay[] }) {
  const { weeks, monthMarks, total } = useMemo(() => build(days), [days])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 overflow-x-auto pb-1">
        {/* 星期标签。只标一三五日，七个全标太密 */}
        <div
          className="flex flex-col shrink-0 pt-[15px] text-[9.5px] text-faint"
          style={{ gap: GAP }}
          aria-hidden="true"
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: 固定的七行标签
              key={index}
              className="flex items-center justify-end w-3 leading-none"
              style={{ height: CELL }}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-[3px]">
          {/* 月份刻度：每月第一列上方标一次 */}
          <div className="relative h-[11px]" aria-hidden="true">
            {monthMarks.map((mark) => (
              <span
                key={`${mark.label}-${mark.column}`}
                className="absolute top-0 text-[9.5px] text-faint leading-none whitespace-nowrap"
                style={{ left: mark.column * (CELL + GAP) }}
              >
                {mark.label}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((week) => (
              <div
                key={week[0]?.date ?? week.length}
                className="flex flex-col"
                style={{ gap: GAP }}
              >
                {week.map((day) =>
                  day ? (
                    <Tooltip key={day.date} content={<DayDetail day={day} />}>
                      <div
                        role="img"
                        aria-label={`${day.date} 新增 ${day.count} 条`}
                        data-heatmap-cell={day.date}
                        style={{ width: CELL, height: CELL }}
                        className={cn(
                          'rounded-[2px] transition-[background-color,transform] duration-150',
                          'hover:scale-[1.35] hover:ring-1 hover:ring-border-strong',
                          LEVEL_CLASS[level(day.count)],
                        )}
                      />
                    </Tooltip>
                  ) : (
                    // 首列可能不是从周一开始，用透明格子占位保持对齐
                    <div
                      key={`pad-${week.length}-${Math.random()}`}
                      style={{ width: CELL, height: CELL }}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10.5px] text-faint">
        <span className="tabular">近一年共 {total} 条</span>
        <span className="flex-1" />
        <span>少</span>
        <div className="flex items-center" style={{ gap: GAP }}>
          {[0, 1, 2, 3, 4].map((value) => (
            <div
              key={value}
              style={{ width: CELL, height: CELL }}
              className={cn('rounded-[2px]', LEVEL_CLASS[value])}
            />
          ))}
        </div>
        <span>多</span>
      </div>
    </div>
  )
}

/** tooltip 内容：日期 + 总数 + 按类型拆分 */
function DayDetail({ day }: { day: ActivityDay }) {
  const kinds = Object.entries(day.byKind).sort((a, b) => b[1] - a[1])
  const [year, month, date] = day.date.split('-')

  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-medium">
        {Number(month)} 月 {Number(date)} 日<span className="text-faint ml-1">{year}</span>
      </div>
      <div>{day.count === 0 ? '没有新增' : `新增 ${day.count} 条`}</div>
      {kinds.length > 0 && (
        <div className="text-faint">
          {kinds.map(([kind, n]) => `${KIND_LABELS[kind] ?? kind} ${n}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

/**
 * 把连续的天切成周列。
 *
 * 第一列多半不是从周一开始，前面补 null 占位，否则整张图会错行 ——
 * 星期几对不上，热力图就失去了「周末 vs 工作日」这层信息。
 */
function build(days: ActivityDay[]) {
  const weeks: Array<Array<ActivityDay | null>> = []
  const monthMarks: Array<{ label: string; column: number }> = []
  let current: Array<ActivityDay | null> = []

  for (const day of days) {
    const parsed = new Date(`${day.date}T00:00:00`)
    // getDay 是周日=0，这里换算成周一=0
    const weekday = (parsed.getDay() + 6) % 7

    if (current.length === 0 && weekday > 0) {
      current = Array.from({ length: weekday }, () => null)
    }

    current.push(day)

    // 只认每月 1 号：首月通常是半截的，按「本月首次出现」打标会把标签
    // 挤在最左边，紧接着的下个月又因防重叠被跳过，看起来像缺了一个月
    if (day.date.slice(8, 10) === '01') {
      monthMarks.push({ label: `${Number(day.date.slice(5, 7))}月`, column: weeks.length })
    }

    if (current.length === 7) {
      weeks.push(current)
      current = []
    }
  }

  if (current.length > 0) {
    while (current.length < 7) current.push(null)
    weeks.push(current)
  }

  return {
    weeks,
    monthMarks,
    total: days.reduce((sum, day) => sum + day.count, 0),
  }
}
