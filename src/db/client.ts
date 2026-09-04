import { mkdirSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { schema } from './schema'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

export type AppDb = BunSQLiteDatabase<typeof schema>

export function createDb(file: string = process.env.DATABASE_URL ?? './data/local.db'): AppDb {
  const sqlite = new Database(file)
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS product_embeddings (
      product_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      vector TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage(day);
  `)
  return drizzle(sqlite, { schema })
}

let _db: AppDb | null = null
export function db(): AppDb {
  if (!_db) {
    const file = process.env.DATABASE_URL ?? './data/local.db'
    if (!file.startsWith(':')) mkdirSync(file.slice(0, file.lastIndexOf('/')) || '.', { recursive: true })
    _db = createDb(file)
  }
  return _db
}
