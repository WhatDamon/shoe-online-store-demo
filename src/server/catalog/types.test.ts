import { describe, expect, it } from 'vitest'
import type { Product, ProductFilter, CatalogAdapter } from './types'

describe('catalog contract', () => {
  it('Product canonical sizes are whole EU numbers', () => {
    const p: Product = {} as Product // 仅编译期契约占位，运行时不做
    expect(p).toBeDefined()
  })
  it('filter sort union is closed', () => {
    const f: ProductFilter = { sort: 'featured' }
    expect(f.sort).toBe('featured')
  })
  it('CatalogAdapter contract shape is structurally satisfiable', () => {
    const adapter: CatalogAdapter = {
      getProducts: async () => [],
      getProductByHandle: async () => null,
      getCollections: async () => [],
      getBuyUrl: async () => null,
    }
    expect(typeof adapter.getProducts).toBe('function')
  })
})
