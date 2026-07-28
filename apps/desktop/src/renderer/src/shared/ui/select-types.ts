export interface SelectOption<T extends string> {
  value: T
  label: string
  /** 次要说明，显示在选项右侧 */
  hint?: string
  disabled?: boolean
}

/** 菜单相对触发器的位置，side 决定展开方向与动画原点 */
export interface MenuRect {
  left: number
  top: number
  width: number
  side: 'down' | 'up'
}

export const MENU_MARGIN = 8
export const MAX_MENU_HEIGHT = 280
export const EXIT_DURATION = 130
