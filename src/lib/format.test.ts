import { describe, expect, it } from 'vitest'
import { formatPrice } from './format'
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
    // 中文界面显示 `$128.00` 是刻意的：把货币绑到 locale 上会改动 ADR 0001 的市场边界。
    expect(market.currency).toBe('USD')
    expect(formatPrice(128, 'en')).toContain('$')
  })
})
