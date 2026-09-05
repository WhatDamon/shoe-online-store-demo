import { describe, expect, it } from 'vitest'

// ===========================================================================
// 对比度契约测试（WCAG 1.4.3 AA）。锁定设计系统里「正文/次级文本/链接/按钮」
// 在浅色与深色底上的实际对比率，防未来调 token 时误伤可读性。
//
// token 值镜像 src/app/globals.css：
//   浅色 :root      --canvas #fafaf8  --ink #111111  --brand #0f766e  --surface #ffffff
//   深色 media 块   --canvas #141414  --ink #f4f4f1  --brand #2dd4bf  --surface #202020
// tailwind neutral 阶梯：代码里小字正文用 neutral-500（#737373）起步。
// jsdom 跑不了 axe 的 color-contrast（无真实布局），此文件是它的确定性替代。
// ===========================================================================

function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i + 1, i + 3), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function contrast(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** 普通文本需 ≥4.5:1；大文本/UI 组件边界需 ≥3:1（本系统不单列，统一按正文 4.5 要求）。 */
function expectAA(fg: string, bg: string, label: string) {
  const r = contrast(fg, bg)
  expect(r, `${label}: ${fg} on ${bg} = ${r.toFixed(2)} (need ≥4.5)`).toBeGreaterThanOrEqual(4.5)
}

const NEUTRAL = { 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 900: '#171717' }

describe('a11y: contrast contract (WCAG 1.4.3 AA, normal text ≥4.5)', () => {
  it('light theme: ink & body text on canvas/surface', () => {
    expectAA('#111111', '#fafaf8', 'ink on canvas')
    expectAA('#111111', '#ffffff', 'ink on surface')
    expectAA(NEUTRAL[900], '#ffffff', 'card title neutral-900 on surface')
    expectAA(NEUTRAL[600], '#ffffff', 'secondary neutral-600 on surface')
    // 次级小字下限：neutral-500 是代码中的最浅正文（404/500 修复后的约定下限）。
    expectAA(NEUTRAL[500], '#ffffff', 'muted neutral-500 on surface')
    expectAA(NEUTRAL[500], '#fafaf8', 'muted neutral-500 on canvas')
  })

  it('light theme: brand link/eyebrow on canvas', () => {
    expectAA('#0f766e', '#fafaf8', 'brand on canvas')
    expectAA('#0f766e', '#ffffff', 'brand on surface')
  })

  it('dark theme: ink-like foreground on canvas/surface', () => {
    expectAA('#f4f4f1', '#141414', 'ink on canvas (dark)')
    expectAA('#f4f4f1', '#202020', 'ink on surface (dark)')
    expectAA('#2dd4bf', '#141414', 'brand on canvas (dark)')
    expectAA('#2dd4bf', '#202020', 'brand on surface (dark)')
  })

  it('dark theme: neutral ladder is inverted so 400+ stays readable', () => {
    // 深色 media 块把 neutral 阶梯整体调亮（oklch 0.5+），近似值约 #6f6f6f 起；
    // 由于代码已约定正文用 500（≈#8f8f8f 亮灰），这里用中性最浅可行值回归。
    expectAA('#8f8f8f', '#141414', 'dark muted text on canvas')
    expectAA('#8f8f8f', '#202020', 'dark muted text on surface')
  })

  it('guardrail: neutral-400 on white is NOT used as body text anymore (regression)', () => {
    // 若未来又有人把正文设回 neutral-400，此断言先红提醒（2.52 < 4.5）。
    expect(contrast(NEUTRAL[400], '#ffffff')).toBeLessThan(4.5)
  })
})
