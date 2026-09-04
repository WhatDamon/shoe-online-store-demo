// Test-only compatibility shim: maps `bun:sqlite` to `node:sqlite`.
//
// Why this exists: Vitest spawns its workers with Node.js (verified:
// process.execPath is the system `node`, no `process.versions.bun`), and
// Node's ESM loader rejects the `bun:` protocol. Production code keeps
// importing `bun:sqlite` (the app runs on Bun via `bun run dev/build`);
// only vitest.config.mts aliases `bun:sqlite` to this file so unit tests can
// exercise the Drizzle bun-sqlite driver path against node:sqlite.
//
// Implemented API surface = what drizzle-orm/bun-sqlite uses at runtime:
// exec / prepare(...).run|all|get / transaction(fn) with behavior methods.
import { DatabaseSync } from 'node:sqlite'

type SQLParam = string | number | bigint | null | Uint8Array

export class Database {
  private readonly db: DatabaseSync

  constructor(path: string = ':memory:') {
    this.db = new DatabaseSync(path)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): {
    run: (...params: SQLParam[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
    all: (...params: SQLParam[]) => Record<string, unknown>[]
    get: (...params: SQLParam[]) => Record<string, unknown> | undefined
    values: (...params: SQLParam[]) => unknown[][]
  } {
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: SQLParam[]) => stmt.run(...params),
      all: (...params: SQLParam[]) => stmt.all(...params),
      get: (...params: SQLParam[]) => stmt.get(...params),
      // drizzle's PreparedQuery.values() path; columns order from the statement
      values: (...params: SQLParam[]) => {
        const names = stmt.columns().map((c) => c.name)
        return stmt.all(...params).map((row) => names.map((n) => (row as Record<string, unknown>)[n]))
      },
    }
  }

  // Mirrors bun:sqlite's Database#transaction: returns a callable whose
  // `.deferred` / `.immediate` / `.exclusive` properties start the txn.
  transaction<T>(fn: () => T): {
    (behavior?: 'deferred' | 'immediate' | 'exclusive'): T
    deferred: () => T
    immediate: () => T
    exclusive: () => T
  } {
    const run = (mode: 'deferred' | 'immediate' | 'exclusive' = 'deferred') => {
      this.db.exec(`BEGIN ${mode.toUpperCase()}`)
      try {
        const result = fn()
        this.db.exec('COMMIT')
        return result
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
    }
    return Object.assign(run, {
      deferred: () => run('deferred'),
      immediate: () => run('immediate'),
      exclusive: () => run('exclusive'),
    })
  }

  close(): void {
    this.db.close()
  }
}
