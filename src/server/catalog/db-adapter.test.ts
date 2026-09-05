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

  it('add-only sync: missing seed rows are re-added, present rows keep DB edits', async () => {
    // 模拟已有人工编辑的既有表：删掉一款 seed、编辑另一款，再用全新适配器首读。
    const { adapter, repo } = make()
    const removed = seedProducts[0]
    const edited = seedProducts[1]
    await repo.upsertProducts([
      productToRecord({ ...edited, title: 'Kept-Edit' }),
      ...seedProducts.filter((p) => p.id !== removed.id && p.id !== edited.id).map(productToRecord),
    ])
    const all = await adapter.getProducts() // 新适配器首读 → 只补缺失 id
    expect(all.length).toBe(seedProducts.length)
    expect(all.find((p) => p.id === removed.id)?.title).toBe(removed.title)
    expect(all.find((p) => p.id === edited.id)?.title).toBe('Kept-Edit')
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
