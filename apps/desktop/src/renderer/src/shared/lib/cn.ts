/**
 * 类名拼接。
 *
 * 没引 clsx + tailwind-merge：这个应用里没有「同一个组件被外部覆盖 padding」
 * 这类场景，冲突合并解决的问题不存在，为它多两个依赖不划算。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
