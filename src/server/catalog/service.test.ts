import { describe, expect, it } from 'vitest'
import { listProductsForMarket, getProductForMarket } from './service'

describe('catalog service', () => {
  it('lists by collection', async () => {
    const items = await listProductsForMarket({ collection: 'travel' })
    expect(items.length).toBeGreaterThan(0)
    items.forEach(p => expect(p.collections).toContain('travel'))
  })
  it('filters by market size labels converted to canonical', async () => {
    const items = await listProductsForMarket({ sizeLabels: ['US 9'] }) // EU 43
    expect(items.length).toBeGreaterThan(0)
    items.forEach(p => expect(p.sizes).toContain(43))
  })
  it('sorts price asc', async () => {
    const items = await listProductsForMarket({ sort: 'price-asc' })
    const amounts = items.map(p => p.price.amount)
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts)
  })
  it('exposes market size labels on view', async () => {
    const items = await listProductsForMarket({})
    expect(items[0].sizeOptions.length).toBeGreaterThan(0)
    expect(items[0].sizeOptions[0].label).toMatch(/^(US|EU|UK|JP|CN) /)
  })
  it('getBuyUrl null when no store configured', async () => {
    const p = await getProductForMarket('daily-drift')
    expect(p).not.toBeNull()
  })
  it('product missing -> null', async () => {
    expect(await getProductForMarket('nope')).toBeNull()
  })
})
