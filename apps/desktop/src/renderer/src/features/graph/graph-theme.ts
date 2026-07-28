/**
 * 图谱的取色。
 *
 * Sigma 渲染在 WebGL 画布上，拿不到 CSS 变量 —— 必须在建图时把
 * 当前主题的颜色读成具体值传进去。主题切换时整张图要重新取色。
 *
 * 这里产出的颜色一律不含透明度，原因见 canvas/color.ts 顶部：
 * Sigma 的混合模式假定颜色已预乘 alpha，直接喂 rgba() 会让元素被推成纯白。
 */

import { overlay } from './canvas/color.js'

export interface GraphPalette {
  /** 节点默认色（实体节点、以及无类型时的兜底） */
  neutral: string
  /** 被淡出的节点/边 */
  dimmed: string
  edge: string
  edgeActive: string
  label: string
  labelDim: string
  highlight: string
  background: string
}

function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function readPalette(): GraphPalette {
  const dark = document.documentElement.dataset.theme === 'dark'
  const background = readVar('--canvas', dark ? '#0a0a0a' : '#ffffff')
  // 边是「在背景上叠一层」，所以按背景实时合成，深浅主题各自成立
  const ink = dark ? '#ffffff' : '#000000'

  return {
    neutral: readVar('--kind-entity', dark ? '#9a9a9a' : '#7a7a7a'),
    dimmed: dark ? '#2a2a2a' : '#dcdcdc',
    edge: overlay(background, ink, 0.1),
    edgeActive: overlay(background, ink, dark ? 0.42 : 0.38),
    label: readVar('--text', dark ? '#f2f2f2' : '#0d0d0d'),
    labelDim: readVar('--text-faint', dark ? '#6b6b6b' : '#9a9a9a'),
    highlight: readVar('--accent', dark ? '#f2f2f2' : '#0d0d0d'),
    background,
  }
}

/**
 * 无焦点时边的底色。
 *
 * 按规模把边往背景里压：边一多，每条都清晰可见反而看不清任何东西 ——
 * 一千条线交织成一张灰网，节点沉在网底下。此时有用的信息是
 * 「哪一片稠密」，靠密度自然浮现，不需要每条线都跳出来。
 */
export function fadeEdge(palette: GraphPalette, alpha: number, dark: boolean): string {
  const ink = dark ? '#ffffff' : '#000000'
  return overlay(palette.background, ink, alpha * 0.35)
}

export function readKindColor(kind: string): string {
  return readVar(`--kind-${kind}`, '#8a8a8a')
}

/**
 * 簇色板。
 *
 * 按簇着色时才用得上。饱和度压得很低 —— 图上可能同时出现十几个簇，
 * 高饱和会让画面变成一盘彩虹糖，反而看不出结构。
 */
const CLUSTER_HUES = [210, 275, 35, 155, 5, 95, 320, 185, 55, 245]

/**
 * 簇色必须输出 hex，不能用 hsl()。
 *
 * Sigma 的颜色解析只认 #hex、rgb() 和 rgba()，遇到 hsl() 会静默解析失败，
 * r/g/b 全取 0 —— 表现是「按簇着色时所有节点变成黑球」。
 * 簇轮廓那层是 2D canvas，认 hsl，所以只有 WebGL 画的节点会黑，
 * 更难联想到是颜色格式的问题。
 */
export function clusterColor(cluster: number, dark = false): string {
  const hue = CLUSTER_HUES[Math.abs(cluster) % CLUSTER_HUES.length] ?? 210
  return hslToHex(hue, dark ? 0.42 : 0.4, dark ? 0.62 : 0.48)
}

function hslToHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const match = l - chroma / 2

  const [r, g, b] =
    h < 60
      ? [chroma, secondary, 0]
      : h < 120
        ? [secondary, chroma, 0]
        : h < 180
          ? [0, chroma, secondary]
          : h < 240
            ? [0, secondary, chroma]
            : h < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary]

  const channel = (value: number) =>
    Math.round((value + match) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}
