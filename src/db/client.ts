import { mkdirSync, readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { checkServerIdentity, type PeerCertificate } from 'node:tls'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from './schema'
import { schema as pgSchema } from './schema-postgres'
import { resolveDbDriver } from './dialect'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export type AppDb = BetterSQLite3Database<typeof schema>
export type PgAppDb = PostgresJsDatabase<typeof pgSchema>
type AnyDb = AppDb | PgAppDb

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
    CREATE TABLE IF NOT EXISTS ai_budget_days (
      day TEXT PRIMARY KEY,
      reserved_tokens INTEGER NOT NULL DEFAULT 0,
      used_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ai_budget_reservations (
      request_id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      reserved_tokens INTEGER NOT NULL,
      actual_tokens INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_day ON ai_budget_reservations(day);
    CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_recovery ON ai_budget_reservations(status, created_at, request_id);
    CREATE TABLE IF NOT EXISTS products (
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

/** 默认连接：按 DB_DRIVER 懒分派 sqlite/postgres；单例缓存。 */
export function db(): AnyDb {
  return resolveDbDriver() === 'postgres' ? (_pg ??= createPostgresDb()) : sqliteDb()
}

export function createPostgresDb(url: string = process.env.DATABASE_URL ?? ''): PgAppDb {
  return drizzlePg(createPostgresClient(url), { schema: pgSchema })
}

export function createPostgresClient(
  url: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (!url) throw new Error('DB_DRIVER=postgres requires DATABASE_URL (postgres://…) URL')
  const ssl = pgConnectOptions(env)
  let hostname = ''
  if (ssl) {
    try {
      const parsed = new URL(url)
      hostname = parsed.hostname.replace(/^\[|\]$/g, '')
      if (
        !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        !hostname ||
        hostname.includes(',')
      ) {
        throw new Error('invalid endpoint')
      }
    } catch {
      throw new Error('Verified PostgreSQL TLS requires one explicit DATABASE_URL hostname')
    }
  }
  // Always pass ssl explicitly: URL/PGSSL options must not weaken this policy.
  return postgres(url, {
    max: 10,
    ssl: ssl
      ? {
          ...ssl,
          // postgres.js omits SNI for IPs; Node can otherwise validate 'localhost'.
          checkServerIdentity: (_name: string, certificate: PeerCertificate) =>
            checkServerIdentity(hostname, certificate),
        }
      : false,
  })
}

// Production always verifies TLS. Development can use an explicit local plaintext
// connection; neither connection strings nor legacy `require` disable verification.
export function pgConnectOptions(
  env: Record<string, string | undefined> = process.env,
): { rejectUnauthorized: true; ca?: string } | null {
  const mode = (env.PG_SSL ?? '').trim().toLowerCase()
  const caFile = (env.PG_SSL_CA_FILE ?? '').trim()
  const production = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
  // Node's process-wide TLS escape hatch must never be present in a
  // production process, even though the client below passes an explicit
  // rejectUnauthorized=true option. Fail closed before creating a client.
  if (production && (env.NODE_TLS_REJECT_UNAUTHORIZED ?? '').trim() === '0') {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed in production')
  }
  if (!['', '0', 'false', '1', 'true', 'require', 'verify-full'].includes(mode)) {
    throw new Error('Invalid PG_SSL: use 1/verify-full, or 0 for local development')
  }
  const disabled = mode === '0' || mode === 'false'
  if (disabled && (production || caFile)) {
    throw new Error('PostgreSQL TLS cannot be disabled in production or with PG_SSL_CA_FILE')
  }
  if (disabled || (!mode && !production && !caFile)) return null
  if (!caFile) return { rejectUnauthorized: true }
  try {
    const ca = readFileSync(caFile, 'utf8')
    // Reject empty/malformed mounts before attempting a network connection.
    new X509Certificate(ca)
    return { rejectUnauthorized: true, ca }
  } catch {
    // Do not expose the file path, certificate, or underlying filesystem error.
    throw new Error('PG_SSL_CA_FILE must contain a readable PEM certificate bundle')
  }
}

// 启动自动建表（零迁移 DX，两侧一致）：每个 pg 实例只执行一次，失败可重试。
const pgTablesReady = new WeakMap<object, Promise<void>>()

export function ensurePgTables(database: PgAppDb): Promise<void> {
  const pending = pgTablesReady.get(database)
  if (pending) return pending
  const run = runPgDdl(database).catch((e) => {
    pgTablesReady.delete(database)
    throw e
  })
  pgTablesReady.set(database, run)
  return run
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
    sql`CREATE TABLE IF NOT EXISTS ai_budget_days (
      day text PRIMARY KEY,
      reserved_tokens integer NOT NULL DEFAULT 0,
      used_tokens integer NOT NULL DEFAULT 0
    )`,
    sql`CREATE TABLE IF NOT EXISTS ai_budget_reservations (
      request_id text PRIMARY KEY,
      day text NOT NULL,
      reserved_tokens integer NOT NULL,
      actual_tokens integer NOT NULL DEFAULT 0,
      status text NOT NULL,
      created_at bigint NOT NULL
    )`,
    sql`CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_day ON ai_budget_reservations (day)`,
    sql`CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_recovery ON ai_budget_reservations (status, created_at, request_id)`,
    sql`CREATE TABLE IF NOT EXISTS products (
      id text PRIMARY KEY,
      handle text NOT NULL UNIQUE,
      title text NOT NULL,
      subtitle text NOT NULL,
      description text NOT NULL,
      price_amount double precision NOT NULL,
      currency text NOT NULL,
      product_type text NOT NULL,
      collections text NOT NULL,
      sizes text NOT NULL,
      colors text NOT NULL,
      features text NOT NULL,
      tags text NOT NULL,
      construction text NOT NULL,
      visual text NOT NULL,
      images text NOT NULL,
      fit_notes text NOT NULL,
      created_at text NOT NULL
    )`,
  ]
  for (const statement of statements) await db.execute(statement)
}
