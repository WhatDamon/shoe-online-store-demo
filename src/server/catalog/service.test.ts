import { describe, expect, it } from 'vitest'
import { listProductsForMarket, getProductForMarket, getRelatedProducts } from './service'
import { seedAdapter } from './seed-adapter'
import { seedProducts } from './seed'

const FIRST_HANDLE = seedProducts[0].handle

describe('catalog service', () => {
  it('lists by collection', async () => {
    const items = await listProductsForMarket({ collection: 'travel' })
    expect(items.length).toBeGreaterThan(0)
    items.forEach((p) => expect(p.collections).toContain('travel'))
  })
  it('filters by market size labels converted to canonical', async () => {
    const items = await listProductsForMarket({ sizeLabels: ['US 9'] }) // EU 43
    expect(items.length).toBeGreaterThan(0)
    items.forEach((p) => expect(p.sizes).toContain(43))
  })
  it('sorts price asc', async () => {
    const items = await listProductsForMarket({ sort: 'price-asc' })
    const amounts = items.map((p) => p.price.amount)
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts)
  })
  it('exposes market size labels on view', async () => {
    const items = await listProductsForMarket({})
    expect(items[0].sizeOptions.length).toBeGreaterThan(0)
    expect(items[0].sizeOptions[0].label).toMatch(/^(US|EU|UK|JP|CN) /)
  })
  it('getBuyUrl null when no store configured', async () => {
    // 无 Shopify 凭证 → seed 适配器生效，getBuyUrl 恒 null（占位 + 适配器就绪）。
    const p = await seedAdapter.getProductByHandle(FIRST_HANDLE)
    expect(p).not.toBeNull()
    if (p) expect(await seedAdapter.getBuyUrl(p)).toBeNull()
  })
  it('product missing -> null', async () => {
    expect(await getProductForMarket('nope')).toBeNull()
  })
  it('related products exclude the current product', async () => {
    const related = await getRelatedProducts(FIRST_HANDLE)
    expect(related.length).toBeGreaterThan(0)
    expect(related.some((p) => p.handle === FIRST_HANDLE)).toBe(false)
  })
  it('related products respect the limit', async () => {
    const related = await getRelatedProducts(FIRST_HANDLE, 2)
    expect(related.length).toBeLessThanOrEqual(2)
    expect(related.length).toBeGreaterThan(0)
  })
  it('related products for an unknown handle are empty', async () => {
    expect(await getRelatedProducts('nope')).toEqual([])
  })
})
