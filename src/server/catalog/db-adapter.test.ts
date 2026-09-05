// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createDb } from '@/db/client'
import { createRepository } from '@/server/search/repository'
import { DbCatalogAdapter } from './db-adapter'
import { seedProducts } from './seed'
import { productToRecord } from '@/db/product-row'

// DbCatalogAdapter（决策 #17）：内存 db 注入，验证自动灌种 + DB 为运行时源。
describe('DbCatalogAdapter', () => {
  const make = () => {
    const db = createDb(':memory:')
    const repo = createRepository(db)
    return { adapter: new DbCatalogAdapter(() => repo), repo }
  }

  it('hydrates the empty products table from the seed layer once', async () => {
    const { adapter, repo } = make()
    expect(await repo.countProducts()).toBe(0)
    const all = await adapter.getProducts()
    expect(all.length).toBe(seedProducts.length)
    expect(await repo.countProducts()).toBe(seedProducts.length)

    // 二次访问不重复灌种
    await adapter.getProducts()
    expect(await repo.countProducts()).toBe(seedProducts.length)
  })

  it('reads the persisted table as the runtime source (edits win over seed)', async () => {
    const { adapter, repo } = make()
    await adapter.getProductByHandle(seedProducts[0].handle) // triggers hydration
    const edited = seedProducts[0]
    await repo.upsertProducts([productToRecord({ ...edited, title: 'DB-Edited' })])
    const fromDb = await adapter.getProductByHandle(edited.handle)
    expect(fromDb?.title).toBe('DB-Edited')
  })

  it('applies filter/sort semantics on top of DB rows', async () => {
    const { adapter } = make()
    const comfort = await adapter.getProducts({ collection: 'comfort' })
    expect(comfort.length).toBeGreaterThan(0)
    expect(comfort.every((p) => p.collections.includes('comfort'))).toBe(true)
    const asc = await adapter.getProducts({ sort: 'price-asc' })
    const prices = asc.map((p) => p.price.amount)
    expect([...prices].sort((a, b) => a - b)).toEqual(prices)
  })
})
