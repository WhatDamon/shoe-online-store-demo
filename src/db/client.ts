import { mkdirSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from './schema'
import { schema as pgSchema } from './schema-postgres'
import { resolveDbDriver } from './dialect'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export type AppDb = BunSQLiteDatabase<typeof schema>
export type PgAppDb = PostgresJsDatabase<typeof pgSchema>
export type AnyDb = AppDb | PgAppDb

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
let _pg: PgAppDb | null = null
/** 默认 sqlite 连接（类型化 AppDb）；懒创建本地文件。 */
export function sqliteDb(): AppDb {
  if (!_db) {
    const file = process.env.DATABASE_URL ?? './data/local.db'
    if (!file.startsWith(':'))
      mkdirSync(file.slice(0, file.lastIndexOf('/')) || '.', {
        recursive: true,
      })
    _db = createDb(file)
  }
  return _db
}

/** 默认连接（决策 #13）：按 DB_DRIVER 懒分派 sqlite/postgres；单例缓存。 */
export function db(): AnyDb {
  return resolveDbDriver() === 'postgres' ? (_pg ??= createPostgresDb()) : sqliteDb()
}

export function createPostgresDb(url: string = process.env.DATABASE_URL ?? ''): PgAppDb {
  if (!url) throw new Error('DB_DRIVER=postgres requires DATABASE_URL (postgres://…) URL')
  const client = postgres(url, { max: 10 })
  return drizzlePg(client, { schema: pgSchema })
}

// 启动自动建表（零迁移 DX，两侧一致）：每个 pg 实例只执行一次，失败可重试。
const pgTablesReady = new WeakMap<object, Promise<void>>()

export function ensurePgTables(db: PgAppDb): Promise<void> {
  if (!pgTablesReady.has(db)) {
    pgTablesReady.set(
      db,
      runPgDdl(db).catch((e) => {
        pgTablesReady.delete(db)
        throw e
      }),
    )
  }
  return pgTablesReady.get(db)!
}

async function runPgDdl(db: PgAppDb): Promise<void> {
  const statements = [
    sql`CREATE TABLE IF NOT EXISTS product_embeddings (
      product_id text PRIMARY KEY,
      content_hash text NOT NULL,
      model text NOT NULL,
      vector text NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS ai_usage (
      id serial PRIMARY KEY,
      day text NOT NULL,
      model text NOT NULL,
      prompt_tokens integer NOT NULL,
      completion_tokens integer NOT NULL,
      session_key text NOT NULL,
      created_at bigint NOT NULL
    )`,
    sql`CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage (day)`,
  ]
  for (const statement of statements) await db.execute(statement)
}
