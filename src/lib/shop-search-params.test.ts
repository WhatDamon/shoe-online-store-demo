import { describe, expect, it } from 'vitest'
import { parseShopParams, serializeShopParams, type ShopFilter } from './shop-search-params'

describe('parseShopParams', () => {
  it('parses multi-value size labels alongside other params', () => {
    const sp = new URLSearchParams('size=US 9&size=US 10.5&collection=travel&minPrice=100&maxPrice=150&q=mesh&sort=price-asc')
    expect(parseShopParams(sp)).toEqual({
      collection: 'travel',
      minPrice: 100,
      maxPrice: 150,
      q: 'mesh',
      sizeLabels: ['US 9', 'US 10.5'],
      sort: 'price-asc',
    })
  })

  it('falls back to featured for an invalid sort value', () => {
    expect(parseShopParams(new URLSearchParams('sort=cheapest')).sort).toBe('featured')
  })

  it('parses an empty query to an empty filter with featured sort', () => {
    expect(parseShopParams(new URLSearchParams(''))).toEqual({ sort: 'featured' })
  })
})

describe('serializeShopParams', () => {
  it('serializes every set field into a query string', () => {
    expect(
      serializeShopParams({
        collection: 'travel',
        sizeLabels: ['US 9', 'US 10.5'],
        minPrice: 100,
        maxPrice: 150,
        q: 'mesh',
        sort: 'price-asc',
      }),
    ).toBe('collection=travel&size=US+9&size=US+10.5&minPrice=100&maxPrice=150&q=mesh&sort=price-asc')
  })

  it('omits unset fields and the featured default', () => {
    expect(serializeShopParams({ sort: 'featured' })).toBe('')
  })

  it('round-trips with parse for a populated filter', () => {
    const f: ShopFilter = {
      collection: 'comfort',
      sizeLabels: ['US 8.5'],
      minPrice: 100,
      q: 'slip',
      sort: 'newest',
    }
    expect(parseShopParams(new URLSearchParams(serializeShopParams(f)))).toEqual(f)
  })
})
