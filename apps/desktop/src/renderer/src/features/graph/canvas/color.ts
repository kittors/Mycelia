/**
 * 图谱的颜色合成。
 *
 * 这里所有函数都只产出**不透明**颜色，这不是洁癖而是必须的：
 * Sigma 的 WebGL 混合用的是 `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`，
 * 也就是假定传进来的颜色已经预乘过 alpha。而 `rgba(122,122,180,0.45)`
 * 这种写法是非预乘的，着色器会算成
 *   0.478 + 1.0 × (1 − 0.45) = 1.03
 * 通道饱和到 1 —— 白色画布上，半透明节点直接变成纯白，整个消失。
 * 深色主题里同理会被推成全白，高亮边糊成一片。
 *
 * 与其小心翼翼地手工预乘（每换一次背景色都要重算），不如在 CPU 上
 * 先把颜色朝背景混好再交给 GPU：结果在任何混合模式下都成立。
 */

type Rgb = [number, number, number]

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_FULL = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const RGB_FN = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i

/** 解析成 RGB 三元组。认不出来的返回 null，由调用方决定兜底 */
export function parseRgb(color: string): Rgb | null {
  const value = color.trim()

  const short = HEX_SHORT.exec(value)
  if (short) {
    return [
      Number.parseInt(`${short[1]}${short[1]}`, 16),
      Number.parseInt(`${short[2]}${short[2]}`, 16),
      Number.parseInt(`${short[3]}${short[3]}`, 16),
    ]
  }

  const full = HEX_FULL.exec(value)
  if (full) {
    return [
      Number.parseInt(full[1] as string, 16),
      Number.parseInt(full[2] as string, 16),
      Number.parseInt(full[3] as string, 16),
    ]
  }

  const fn = RGB_FN.exec(value)
  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
  }

  return null
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/**
 * 把 color 朝 background 混，amount 是背景占的比例。
 *
 * amount=0 保持原色，amount=1 完全变成背景色（等于隐形）。
 * 视觉上等价于「透明度 1−amount」，但产出的是实色。
 */
export function fade(color: string, background: string, amount: number): string {
  const front = parseRgb(color)
  const back = parseRgb(background)
  if (!front || !back) return color

  const ratio = Math.min(1, Math.max(0, amount))
  return toHex([
    front[0] + (back[0] - front[0]) * ratio,
    front[1] + (back[1] - front[1]) * ratio,
    front[2] + (back[2] - front[2]) * ratio,
  ])
}

/** 在背景上叠一层指定强度的前景色，用来造边线这类「淡淡一层」的颜色 */
export function overlay(background: string, foreground: string, strength: number): string {
  return fade(foreground, background, 1 - strength)
}
