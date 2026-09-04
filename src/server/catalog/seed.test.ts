import { describe, expect, it } from 'vitest'
import { seedProducts } from './seed'
import { collections } from './collections'
import { sizeRows } from './size-fixture'

describe('seed integrity', () => {
  it('has 16–20 products', () => {
    expect(seedProducts.length).toBeGreaterThanOrEqual(16)
    expect(seedProducts.length).toBeLessThanOrEqual(20)
  })
  it('handles are unique slugs', () => {
    const hs = seedProducts.map((p) => p.handle)
    expect(new Set(hs).size).toBe(hs.length)
    hs.forEach((h) => expect(h).toMatch(/^[a-z0-9-]+$/))
  })
  it('every product belongs to an existing collection', () => {
    const handles = new Set(collections.map((c) => c.handle))
    seedProducts.forEach((p) => p.collections.forEach((c) => expect(handles.has(c)).toBe(true)))
  })
  it('canonical sizes exist in fixture', () => {
    // 显式 Set<number>：fixture 为 as const，map 出的是字面量联合，否则 has(s: number) 报 TS2345
    const eus = new Set<number>(sizeRows.map((r) => r.systems.EU))
    seedProducts.forEach((p) => p.sizes.forEach((s) => expect(eus.has(s)).toBe(true)))
  })
  it('prices are positive USD', () => {
    seedProducts.forEach((p) => {
      expect(p.price.currencyCode).toBe('USD')
      expect(p.price.amount).toBeGreaterThan(0)
    })
  })
  it('visual palettes are valid hex', () => {
    seedProducts.forEach((p) => {
      p.visual.palette.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
      expect(p.visual.accent).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })
})
