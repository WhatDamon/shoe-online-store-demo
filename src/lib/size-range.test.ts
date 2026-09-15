import { describe, expect, it, vi } from 'vitest'
import { sizeRangeLabel } from './size-range'
import { sizeLabel, sizeRangeFromCanonical } from '@/domain/size'
import { convert } from '@/domain/size'
import { market } from '@/lib/market'
import { seedProducts } from '@/server/catalog/seed'
import type { CanonicalSize } from '@/domain/product'

/**
 * label 一律由真实换算表派生（sizeLabel），不手写。
 * 此前用例手写 (value, label) 对，与 size-fixture 矛盾（EU 43 写成 US 10，表里是 US 9）；
 * 旧实现把数字从传入 label 里读回来，所以那些断言恒真 —— 测的是解析器不是生产行为。
 */
const options = (...sizes: CanonicalSize[]) =>
  sizes.map((value) => ({ value, label: sizeLabel(value) }))

describe('sizeRangeLabel', () => {
  it('空列表 → null（不得退化成 "<系统> null"）', () => {
    expect(sizeRangeLabel([])).toBeNull()
  })

  it('单档只显示该档', () => {
    expect(sizeRangeLabel(options(44))).toBe(sizeLabel(44))
  })

  it('多档只保留一次体系前缀', () => {
    const lo = convert(43, market.sizeSystem)
    const hi = convert(44, market.sizeSystem)
    expect(sizeRangeLabel(options(43, 44))).toBe(`${market.sizeSystem} ${lo}–${hi}`)
  })

  it('乱序输入按 canonical 值归一', () => {
    expect(sizeRangeLabel(options(45, 42))).toBe(sizeRangeLabel(options(42, 45)))
  })

  it('显示系统由 market 决定，不由传入 label 决定', () => {
    vi.stubEnv('SITE_MARKET', 'EU')
    try {
      expect(sizeRangeLabel(options(43, 44, 45))).toBe('EU 43–45')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('真实目录一致性：卡片角标与 canonical 区间同源', () => {
  it('每款商品角标 == sizeRangeFromCanonical，且形如 "<系统> <数值>[–<数值>]"', () => {
    expect(seedProducts.length).toBeGreaterThan(0)
    for (const p of seedProducts) {
      const badge = sizeRangeLabel(p.sizes.map((value) => ({ value, label: sizeLabel(value) })))
      expect(badge).toBe(sizeRangeFromCanonical(p.sizes))
      if (badge !== null) expect(badge).toMatch(/^(US|EU|UK|JP|CN) \d+(\.\d+)?(–\d+(\.\d+)?)?$/)
    }
  })

  it('零码款返回 null（真实目录中存在一款无码商品）', () => {
    const noSizes = seedProducts.filter((p) => p.sizes.length === 0)
    expect(noSizes.length).toBeGreaterThan(0)
    for (const p of noSizes) expect(sizeRangeFromCanonical(p.sizes)).toBeNull()
  })
})
