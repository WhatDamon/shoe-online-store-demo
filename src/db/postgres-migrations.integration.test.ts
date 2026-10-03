// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { ensurePgTables, type PgAppDb } from './client'
import { schema } from './schema-postgres'

const testUrl = process.env.AI_TEST_POSTGRES_MIGRATIONS_URL

describe.runIf(Boolean(testUrl))('PostgreSQL schema migration integration', () => {
  let admin: ReturnType<typeof postgres> | undefined
  let clients: ReturnType<typeof postgres>[] = []
  let databases: PgAppDb[] = []

  beforeAll(async () => {
    const url = new URL(testUrl!)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.pathname.endsWith('_test') ||
      url.searchParams.has('options')
    ) {
      throw new Error(
        'Migration integration requires a dedicated loopback PostgreSQL _test database',
      )
    }

    admin = postgres(testUrl!, { max: 1, ssl: false, connect_timeout: 10, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS "drizzle" CASCADE`
    clients = [
      postgres(testUrl!, { max: 1, ssl: false, connect_timeout: 10, onnotice: () => {} }),
      postgres(testUrl!, { max: 1, ssl: false, connect_timeout: 10, onnotice: () => {} }),
    ]
    databases = clients.map((client) => drizzle(client, { schema }))
  }, 20000)

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })))
    await admin?.end({ timeout: 5 })
  })

  it('applies one migration marker across independent startup clients', async () => {
    await Promise.all(databases.map((database) => ensurePgTables(database)))

    const [markerCount] = await admin!`
      SELECT count(*)::int AS count
      FROM "drizzle"."__drizzle_migrations"
    `
    expect(markerCount?.count).toBe(1)

    const [productsTable] = await admin!`
      SELECT to_regclass('public.products') AS table_name
    `
    expect(productsTable?.table_name).toBe('products')
  }, 20000)
})
