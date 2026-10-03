// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { aiBudgetDays, aiBudgetReservations, aiUsage, productEmbeddings, products } from './schema'

const openDatabases: Database.Database[] = []
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'evoloop-drizzle-migrations-'))
  temporaryDirectories.push(directory)
  return join(directory, 'catalog.db')
}

function keepClient(db: ReturnType<typeof createDb>) {
  const client = (db as unknown as { $client: Database.Database }).$client
  openDatabases.push(client)
}

const legacyProduct = {
  id: 'legacy-product',
  handle: 'legacy-product',
  title: 'Legacy product',
  subtitle: 'Preserved row',
  description: 'Created before versioned migrations.',
  priceAmount: 199,
  currency: 'CNY',
  productType: 'shoe',
  collections: '[]',
  sizes: '[]',
  colors: '[]',
  features: '[]',
  tags: '[]',
  construction: '{}',
  visual: '{}',
  images: '[]',
  fitNotes: '',
  createdAt: '2026-10-03',
}

describe('versioned TypeScript database migrations', () => {
  it('initializes every table in an empty SQLite database', async () => {
    const db = createDb(':memory:')

    await Promise.all([
      db.select().from(products).limit(1),
      db.select().from(productEmbeddings).limit(1),
      db.select().from(aiUsage).limit(1),
      db.select().from(aiBudgetDays).limit(1),
      db.select().from(aiBudgetReservations).limit(1),
    ])
  })

  it('applies a file migration once and preserves data across repeated opens', async () => {
    const file = temporaryDatabasePath()
    const first = createDb(file)
    keepClient(first)
    await first.insert(products).values(legacyProduct)

    const second = createDb(file)
    keepClient(second)
    const rows = await second.select().from(products)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(legacyProduct.id)

    const inspector = new Database(file, { readonly: true })
    expect(
      (
        inspector.prepare('SELECT COUNT(*) AS count FROM "__drizzle_migrations"').get() as {
          count: number
        }
      ).count,
    ).toBe(1)
    inspector.close()
  })

  it('takes over tables created by the legacy inline DDL without deleting rows', async () => {
    const file = temporaryDatabasePath()
    const legacy = new Database(file)
    openDatabases.push(legacy)
    legacy.exec(`
      CREATE TABLE product_embeddings (
        product_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        vector TEXT NOT NULL
      );
      CREATE TABLE ai_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        session_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE ai_budget_days (
        day TEXT PRIMARY KEY,
        reserved_tokens INTEGER NOT NULL DEFAULT 0,
        used_tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE ai_budget_reservations (
        request_id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        reserved_tokens INTEGER NOT NULL,
        actual_tokens INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        description TEXT NOT NULL,
        price_amount REAL NOT NULL,
        currency TEXT NOT NULL,
        product_type TEXT NOT NULL,
        collections TEXT NOT NULL,
        sizes TEXT NOT NULL,
        colors TEXT NOT NULL,
        features TEXT NOT NULL,
        tags TEXT NOT NULL,
        construction TEXT NOT NULL,
        visual TEXT NOT NULL,
        images TEXT NOT NULL,
        fit_notes TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO products (
        id, handle, title, subtitle, description, price_amount, currency,
        product_type, collections, sizes, colors, features, tags, construction,
        visual, images, fit_notes, created_at
      ) VALUES (
        'legacy-product', 'legacy-product', 'Legacy product', 'Preserved row',
        'Created before versioned migrations.', 199, 'CNY', 'shoe', '[]', '[]',
        '[]', '[]', '[]', '{}', '{}', '[]', '', '2026-10-03'
      );
    `)
    legacy.close()
    openDatabases.splice(openDatabases.indexOf(legacy), 1)

    const db = createDb(file)
    keepClient(db)
    const rows = await db.select().from(products)
    expect(rows.map((row) => row.id)).toEqual(['legacy-product'])

    const inspector = new Database(file, { readonly: true })
    expect(
      inspector
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ai_usage_day'",
        )
        .get(),
    ).toBeTruthy()
    inspector.close()
  })
})
