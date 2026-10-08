// @vitest-environment node
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { ensurePgTables, type PgAppDb } from './client'

type FakeTransaction = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>
  begin: <T>(callback: (tx: FakeTransaction) => Promise<T> | T) => Promise<T>
  unsafe: (statement: string) => Promise<unknown[]>
}

function fakeClient() {
  const calls: string[] = []
  const tx = ((strings: TemplateStringsArray) => {
    const statement = strings.raw.join('?').replace(/\s+/g, ' ').trim()
    calls.push(statement)
    return Promise.resolve([])
  }) as unknown as FakeTransaction
  tx.begin = async (callback) => callback(tx)
  tx.unsafe = async (statement) => {
    calls.push(`unsafe:${statement.slice(0, 24)}`)
    return []
  }

  return { client: { begin: tx.begin } as unknown as ReturnType<typeof postgres>, calls }
}

function retryingClient() {
  const calls: string[] = []
  let attempts = 0
  const tx = ((strings: TemplateStringsArray) => {
    calls.push(strings.raw.join('?').replace(/\s+/g, ' ').trim())
    return Promise.resolve([])
  }) as unknown as FakeTransaction
  tx.begin = async (callback) => {
    attempts++
    if (attempts === 1) throw new Error('migration failed')
    return callback(tx)
  }
  tx.unsafe = async (statement) => {
    calls.push(`unsafe:${statement.slice(0, 24)}`)
    return []
  }

  return {
    client: { begin: tx.begin } as unknown as ReturnType<typeof postgres>,
    calls,
    get attempts() {
      return attempts
    },
  }
}

describe('PostgreSQL migration locking', () => {
  it('takes the advisory transaction lock before migration DDL', async () => {
    const { client, calls } = fakeClient()
    const database = { $client: client } as unknown as PgAppDb

    await ensurePgTables(database)

    expect(calls[0]).toContain('pg_advisory_xact_lock')
    expect(calls.indexOf('CREATE SCHEMA IF NOT EXISTS "drizzle"')).toBeGreaterThan(0)
    expect(calls.some((call) => call.startsWith('unsafe:'))).toBe(true)
    expect(calls.some((call) => call.startsWith('INSERT INTO "drizzle"'))).toBe(true)
  })

  it('allows a later startup to retry after a failed migration transaction', async () => {
    const fake = retryingClient()
    const database = { $client: fake.client } as unknown as PgAppDb

    await expect(ensurePgTables(database)).rejects.toThrow('migration failed')
    await ensurePgTables(database)

    expect(fake.attempts).toBe(2)
  })
})
