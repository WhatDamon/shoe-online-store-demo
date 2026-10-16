// MySizeGuide 拼接句的**精确串**守卫（与 `my-size-guide.test.tsx` 互补，不合并进该文件）。
//
// 为什么另开一个新文件：既有三条断言是**子串正则**（`/My size:/`、`/outside adult sizes/`、
// `/outside our current size range/`），正是它们让上一轮真实发生的 `((US 4.5–12.5))` 双括号溜了
// 过去（task-8 报告 §1.2）；而那个文件在受保护清单里，既有断言禁止修改。故按裁决 R22「纯新增
// 允许、改既有断言禁止」新增本文件：断言**完整句子**，对括号层数、破折号形状、冒号后的空格与
// 各片段拼接位置全部敏感。
//
// 期望值取自**改造前**（`6700dd0`）的 `my-size-guide.tsx` 原文：
//   {mm}mm{inTable ? '' : ' — outside adult sizes'}
//   That foot length is outside our current size range (US 4.5–12.5). Pick a size in the
//   range to get matched guidance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { footMmToSystem } from '@/domain/size'
import { market } from '@/lib/market'

// MySizeGuide 的 `useSyncExternalStore` 读的是导入期快照，跨测试须重置模块级缓存
// （与 my-size-guide.test.tsx 同款：清 localStorage + resetModules）。
beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

/** 表外脚长的量程提示；前导空格归句子片段（词典侧），`mm` 归组件。 */
const OUTSIDE_ADULT_NOTE = '220mm — outside adult sizes'

/** 表外脚长的整句；括号恰好一层——上一轮真实出错处就是这里多了一层。 */
const OUT_OF_RANGE_SENTENCE =
  'That foot length is outside our current size range (US 4.5–12.5). Pick a size in the range to get matched guidance.'

/** 把滑杆拉到表外（< 227mm）。 */
function renderAtOutsideMm(Guide: () => ReactElement): void {
  render(<Guide />)
  fireEvent.change(screen.getByRole('slider', { name: /foot length/i }), {
    target: { value: '220' },
  })
}

describe('MySizeGuide 拼接句精确串', () => {
  it('已保存时触发行为「My size:」+ 空格 + 换算值 + 空格 + 体系名的整串', async () => {
    window.localStorage.setItem('evoloop:foot-mm', '265')
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    render(<Guide />)

    // 期望值由 domain 换算与市场体系推导，不手写 mm↔尺码对照（尺码表是演示数据）。
    const sizeLabel = footMmToSystem(265, market.sizeSystem)
    // 265mm 在表内，才会渲染数值而不是表外的 '—'：句式断言在这里才有意义。
    expect(sizeLabel).toBeTypeOf('number')
    const expected = `My size: ${String(sizeLabel)} ${market.sizeSystem}`

    // 先按整串定位（`getByText` 的默认归一化会合并空白），再断言 `textContent` 逐字相等——
    // 后者对「冒号后是两个空格」这类空白回归也敏感。
    expect(screen.getByText(expected).textContent).toBe(expected)
  })

  it('表外脚长的量程提示是「220mm — outside adult sizes」整串（前导空格与破折号都在）', async () => {
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    renderAtOutsideMm(Guide)

    expect(screen.getByText(OUTSIDE_ADULT_NOTE).textContent).toBe(OUTSIDE_ADULT_NOTE)
  })

  it('表外脚长的整句逐字一致，且量程括号恰好一层', async () => {
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    renderAtOutsideMm(Guide)

    const node = screen.getByText(OUT_OF_RANGE_SENTENCE)
    expect(node.textContent).toBe(OUT_OF_RANGE_SENTENCE)
    // 整串相等已覆盖 `((US 4.5–12.5))`；这里显式把「括号只允许一层」写成断言，
    // 使改动此处的人不会被「只是拼写」误导。
    expect(node.textContent?.match(/[()]/g)?.length).toBe(2)
  })
})
