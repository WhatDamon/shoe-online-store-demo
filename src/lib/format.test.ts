import { describe, expect, it } from 'vitest'
import { formatPostDate, formatPrice, plural } from './format'
import { market } from './market'
import type { Price } from '@/domain/product'

describe('formatPrice', () => {
  it('formats dollars with two decimals', () => expect(formatPrice(139)).toBe('$139.00'))
  it('formats an amount carried by a Price contract (currencyCode USD) in USD', () => {
    const price: Price = { amount: 98, currencyCode: 'USD' }
    expect(formatPrice(price.amount)).toBe('$98.00')
  })
})

describe('formatPrice 的 locale 参数', () => {
  it('显式 locale 与今天的输出一致：locale 只决定排版', () => {
    expect(formatPrice(139, 'en')).toBe('$139.00')
  })

  it('货币仍由市场决定（USD）：语言与市场正交', () => {
    // 价格的市场由 `market.currency` 决定，locale 只影响排版：把货币绑到 locale 上
    // 会改动 ADR 0001 的市场边界（非 en 的实际输出见下一条）。
    expect(market.currency).toBe('USD')
    expect(formatPrice(128, 'en')).toContain('$')
  })

  // 阶段 1 遗留的「不可验证代码」：`locale` 参数没有任何调用点传过、测试也只断言默认值，
  // 于是一个完全忽略 locale 的实现也能全绿。下面两组非 en 断言就是钉住它的。
  it('非 en 输出逐字不同，但货币仍是 USD（不是人民币）', () => {
    expect(formatPrice(128, 'en')).toBe('$128.00')
    // zh-CN 下 `Intl` 给美元加市场限定符（前导 `US$`），仍是同一市场货币
    expect(formatPrice(128, 'zh-CN')).toBe('US$128.00')
    expect(formatPrice(128, 'zh-CN')).not.toContain('¥')
  })
})

describe('formatPostDate 按语言排版', () => {
  it('en 形态是 `Aug 1, 2026`', () => {
    expect(formatPostDate('2026-08-01', 'en')).toBe('Aug 1, 2026')
  })

  it('zh-CN 形态是中文日期，与 en 逐字不同（locale 参数真的被用）', () => {
    expect(formatPostDate('2026-08-01', 'zh-CN')).toBe('2026年8月1日')
  })
})

describe('plural 按语言的复数规则选形', () => {
  const forms = { one: 'one item', other: 'many items' }

  it('英文 1 → one，0 与 5 → other', () => {
    expect(plural(1, 'en', forms)).toBe('one item')
    expect(plural(0, 'en', forms)).toBe('many items')
    expect(plural(5, 'en', forms)).toBe('many items')
  })

  it('zh-CN 无形态差异：1 与 5 都取 other（不是 `count === 1` 那种实现）', () => {
    // 中文两形在词典里可能同值（如 '件'/'件'），但**不断言两键相等**：那是偶然相等，
    // 冻成不变量后，以后给某一形换词就会红。这里用不同值的 forms 证明选形确实走了
    // `Intl.PluralRules`（若按英文规则选，1 会得到 one 形）。
    const zhForms = { one: '一件', other: '五件' }
    expect(plural(1, 'zh-CN', zhForms)).toBe('五件')
    expect(plural(5, 'zh-CN', zhForms)).toBe('五件')
  })
})
