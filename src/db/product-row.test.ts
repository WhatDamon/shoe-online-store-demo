import { describe, expect, it } from 'vitest'
import { seedProducts } from '@/server/catalog/seed'
import { productFromRecord, productToRecord } from './product-row'

describe('product row codec (decision #17)', () => {
  it('round-trips a real catalog product byte-identical', () => {
    for (const p of seedProducts.slice(0, 3)) {
      expect(productFromRecord(productToRecord(p))).toEqual(p)
    }
  })

  it('stores optional lists as JSON arrays (colors/images missing -> [])', () => {
    const { colors, images, ...rest } = seedProducts[0]
    const record = productToRecord({ ...rest, colors: undefined, images: undefined })
    expect(record.colors).toBe('[]')
    expect(record.images).toBe('[]')
    const back = productFromRecord(record)
    expect(back.colors).toEqual([])
    expect(back.images).toEqual([])
  })

  it('throws on corrupt JSON instead of silently degrading', () => {
    const record = productToRecord(seedProducts[0])
    expect(() => productFromRecord({ ...record, sizes: '{not json' })).toThrow(/corrupt JSON/)
  })
})
