import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Command,
  Database,
  Filter,
  FolderClosed,
  Hash,
  History,
  House,
  Inbox,
  Info,
  Layers,
  Link2,
  Lock,
  LockOpen,
  Monitor,
  Moon,
  MoreHorizontal,
  Notebook,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Shield,
  Sparkles,
  SquareArrowOutUpRight,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

/**
 * 图标。
 *
 * 用 Lucide 而不是继续手写 SVG 路径：手写的问题不在工作量，在**一致性** ——
 * 每新增一个都要重新拿捏视觉重量、端点圆角、留白，攒到几十个之后
 * 总有那么几个显得格格不入。Lucide 整套按同一网格和线宽绘制，
 * 而且它是 Feather 的继任者，那种克制的线性风格正好配这套中性界面。
 *
 * 这里只做一层名字映射：调用方仍然写 `<Icon name="graph" />` 这样的语义名，
 * 而不是直接引 Lucide 的组件。换图标时改一行映射即可，不必翻遍所有调用点；
 * 语义名也比 `Share2` 这种更说明用途。
 *
 * 按需引入，tree-shaking 之后只打包用到的那些。
 */

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>

/**
 * 语义名 → 图标。
 *
 * 左边是界面里的概念（记忆、图谱、保险箱），右边才是 Lucide 的组件名。
 * 两者刻意分开，免得业务代码里出现一堆 Share2、Boxes 这种看不出用途的名字。
 */
const ICONS = {
  // ── 导航 ──
  home: House,
  graph: Share2,
  memory: Notebook,
  review: Inbox,
  inbox: Inbox,
  library: Layers,
  timeline: History,
  vault: Shield,
  settings: Settings,

  // ── 操作 ──
  search: Search,
  sync: RefreshCw,
  plus: Plus,
  check: Check,
  x: X,
  edit: Pencil,
  trash: Trash2,
  filter: Filter,
  more: MoreHorizontal,
  external: SquareArrowOutUpRight,
  command: Command,

  // ── 方向 ──
  chevron: ChevronRight,
  'chevron-down': ChevronDown,
  'arrow-right': ArrowRight,

  // ── 状态与属性 ──
  pin: Pin,
  lock: Lock,
  unlock: LockOpen,
  spark: Sparkles,
  info: Info,
  alert: AlertTriangle,
  clock: Clock,
  link: Link2,

  // ── 对象 ──
  database: Database,
  agent: Boxes,
  tag: Hash,
  folder: FolderClosed,
  file: Notebook,

  // ── 主题 ──
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

/**
 * 支持填充的图标。
 *
 * Lucide 全套都是线稿，没有实心变体。但「已钉住」这类状态必须有实色区分 ——
 * 13px 的图标上光靠颜色深浅根本分辨不出来。给线稿内部填色即可。
 */
const FILLABLE: Partial<Record<IconName, true>> = { pin: true }

export function Icon({
  name,
  size = 16,
  filled,
  ...props
}: {
  name: IconName
  size?: number
  /** 填充内部，用于表达「已激活」。仅部分图标支持，见 FILLABLE */
  filled?: boolean
} & SVGProps<SVGSVGElement>) {
  const Component = ICONS[name]
  return (
    <Component
      aria-hidden="true"
      width={size}
      height={size}
      // 比 Lucide 默认的 2 细一档 —— 中性灰的界面里线条太重会显得脏
      strokeWidth={1.75}
      fill={filled && FILLABLE[name] ? 'currentColor' : 'none'}
      {...props}
    />
  )
}
