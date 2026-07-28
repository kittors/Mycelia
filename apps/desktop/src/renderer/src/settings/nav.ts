import type { IconName } from '../shared/ui/index.js'

export type PaneId = 'agents' | 'models' | 'capture' | 'knowledge' | 'appearance' | 'about'

export interface PaneMeta {
  id: PaneId
  label: string
  icon: IconName
  /** 页头的一句话说明 */
  description: string
}

interface NavGroup {
  label: string
  items: readonly PaneMeta[]
}

/**
 * 设置的导航结构。
 *
 * 按「配什么」分组，不按「改哪个配置字段」分：
 * 接入是一次性动作，模型和准入是要反复调的，外观与关于是杂项。
 */
export const SETTINGS_NAV: readonly NavGroup[] = [
  {
    label: '接入',
    items: [
      {
        id: 'agents',
        label: 'Agent',
        icon: 'agent',
        description: '把记忆库接到本机的 coding agent 上',
      },
    ],
  },
  {
    label: '知识',
    items: [
      {
        id: 'models',
        label: '模型',
        icon: 'spark',
        description: '文本模型与嵌入模型',
      },
      {
        id: 'capture',
        label: '写入把关',
        icon: 'inbox',
        description: '什么内容值得进知识库',
      },
      {
        id: 'knowledge',
        label: '文档索引',
        icon: 'library',
        description: '文档如何切分与检索',
      },
    ],
  },
  {
    label: '应用',
    items: [
      {
        id: 'appearance',
        label: '外观',
        icon: 'monitor',
        description: '主题与显示',
      },
      {
        id: 'about',
        label: '关于',
        icon: 'info',
        description: '版本与数据位置',
      },
    ],
  },
]

export const ALL_PANES: readonly PaneMeta[] = SETTINGS_NAV.flatMap((group) => group.items)

export function paneMeta(id: PaneId): PaneMeta {
  return ALL_PANES.find((pane) => pane.id === id) ?? ALL_PANES[0]!
}
