/** 迁移的形状。每条是幂等的纯 SQL，按 version 顺序执行一次 */
export interface Migration {
  version: number
  name: string
  up: string
}
