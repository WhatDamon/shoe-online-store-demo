import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import {
  aiUsage as pgUsage,
  aiBudgetDays as pgBudgetDays,
  aiBudgetReservations as pgBudgetReservations,
  productEmbeddings as pgEmbeddings,
  products as pgProducts,
} from './schema-postgres'
import {
  aiUsage as sqliteUsage,
  aiBudgetDays as sqliteBudgetDays,
  aiBudgetReservations as sqliteBudgetReservations,
  productEmbeddings as sqliteEmbeddings,
  products as sqliteProducts,
} from './schema'

const columnKeys = (table: object) => Object.keys(getTableColumns(table as never)).sort()

describe('dual-dialect schema parity (spec decision #13)', () => {
  it('product_embeddings column keys match between drivers', () => {
    expect(columnKeys(pgEmbeddings)).toEqual(columnKeys(sqliteEmbeddings))
  })
  it('ai_usage column keys match between drivers (PK/datetime SQL semantics may differ)', () => {
    expect(columnKeys(pgUsage)).toEqual(columnKeys(sqliteUsage))
  })
  it('AI budget column keys match between drivers', () => {
    expect(columnKeys(pgBudgetDays)).toEqual(columnKeys(sqliteBudgetDays))
    expect(columnKeys(pgBudgetReservations)).toEqual(columnKeys(sqliteBudgetReservations))
  })
  it('products column keys match between drivers (decision #17)', () => {
    expect(columnKeys(pgProducts)).toEqual(columnKeys(sqliteProducts))
  })
})
