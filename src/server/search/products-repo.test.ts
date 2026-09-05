// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '@/db/client'
import { createRepository } from '@/server/search/repository'
import { seedProducts } from '@/server/catalog/seed'
import { productToRecord } from '@/db/product-row'

describe('products table repository (decision #17)', () => {
  const db = createDb(':memory:')
  const repo = createRepository(db)
  beforeEach(async () => {
    await repo.wipe()
  })

  it('upserts, counts and lists all rows', async () => {
    const rows = seedProducts.slice(0, 2).map(productToRecord)
    await repo.upsertProducts(rows)
    expect(await repo.countProducts()).toBe(2)
    expect((await repo.listAllProducts()).map((r) => r.handle).sort()).toEqual(
      [rows[0].handle, rows[1].handle].sort(),
    )
  })

  it('upsert by id updates in place without duplicating rows', async () => {
    const row = productToRecord(seedProducts[0])
    await repo.upsertProducts([row])
    await repo.upsertProducts([{ ...row, title: 'Renamed' }])
    expect(await repo.countProducts()).toBe(1)
    expect((await repo.listAllProducts())[0].title).toBe('Renamed')
  })

  it('keeps products out of embedding/usage wipe isolation scope (wipe clears all three)', async () => {
    await repo.upsertProducts(seedProducts.slice(0, 1).map(productToRecord))
    await repo.wipe()
    expect(await repo.countProducts()).toBe(0)
  })
})
