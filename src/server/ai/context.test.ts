// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sizeRangeFromCanonical } from '@/domain/size'
import { seedProducts } from '@/server/catalog/seed'
import type { Product } from '@/domain/product'
import { digestLines, productContextOf, toCard } from './context'

const base = seedProducts[0]
const withProduct = (over: Partial<Product>): Product => ({ ...base, ...over })
const firstColor = seedProducts.flatMap((p) => p.colors ?? [])[0]

// 价格只存在于详情页与店铺：AI 既不向用户展示 demo 价段，也不向模型传播。
// 这两条断言对「模型可见」与「用户可见」两种投影都成立。
const expectNoPrice = (text: string) => {
  expect(text).not.toMatch(/\$\s*\d/)
  expect(text).not.toMatch(/\bUSD\b/i)
}

describe('toCard', () => {
  it('有真实照片 → photo 卡，照片数为真实张数', () => {
    const card = toCard(withProduct({ images: ['/a.webp', '/b.webp'] }))
    expect(card).toMatchObject({ image: '/a.webp', imageKind: 'photo', photoCount: 2 })
  })

  it('无照片 → svg 兜底（由 UI 以 ProductVisual 色卡视觉接管）', () => {
    expect(toCard(withProduct({ images: [] }))).toMatchObject({ image: null, imageKind: 'svg' })
  })

  it('码段与色卡数取自真实数据，且不含价格字段', () => {
    const card = toCard(base)
    expect(card.sizeRange).toBe(sizeRangeFromCanonical(base.sizes))
    expect(card.colorCount).toBe(base.colors?.length ?? 0)
    expect(card.palette).toEqual(base.visual.palette)
    expect(Object.keys(card)).not.toContain('price')
  })

  it('全目录每一张卡都不携带价格', () => {
    for (const p of seedProducts) expectNoPrice(JSON.stringify(toCard(p)))
  })
})

describe('digestLines', () => {
  it('每行一个商品，含标题 / 品类 / 描述', () => {
    const lines = digestLines([base]).split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(base.title)
    expect(lines[0]).toContain(base.productType)
    expect(lines[0]).toContain(base.description)
  })

  it('行数等于商品数，且不携带价格', () => {
    const two = seedProducts.slice(0, 2)
    const digest = digestLines(two)
    expect(digest.split('\n')).toHaveLength(2)
    expectNoPrice(digest)
  })
})

describe('productContextOf', () => {
  it('含货号（handle 大写，等于供应商码）/ 配色 / 码段 / 照片数 / 特性', () => {
    const ctx = productContextOf(base)
    expect(ctx).toContain(`Product: ${base.title}.`)
    expect(ctx).toContain(`Code: ${base.handle.toUpperCase()}.`)
    expect(ctx).toContain(`Available sizes: ${sizeRangeFromCanonical(base.sizes)}.`)
    expect(ctx).toContain(`Photos: ${base.images?.length}.`)
    expect(ctx).toContain(base.features[0])
  })

  it('超 6 色截断展示但保留总数', () => {
    const colors = Array.from({ length: 8 }, (_, i) => ({ ...firstColor, name: `c${i}` }))
    const ctx = productContextOf(withProduct({ colors }))
    expect(ctx).toContain('Colors: c0, c1, c2, c3, c4, c5, … (8 total).')
    expect(ctx).not.toContain('c6')
  })

  it('空字段不产出空句子（无配色 / 无码 / 无图 / 无特性）', () => {
    const ctx = productContextOf(withProduct({ colors: [], sizes: [], images: [], features: [] }))
    expect(ctx).not.toContain('Colors:')
    expect(ctx).not.toContain('Available sizes:')
    expect(ctx).not.toContain('Photos:')
    expect(ctx).not.toContain('Details:')
    expect(ctx).not.toContain('undefined')
  })

  it('全目录都不携带价格', () => {
    for (const p of seedProducts) expectNoPrice(productContextOf(p))
  })
})
