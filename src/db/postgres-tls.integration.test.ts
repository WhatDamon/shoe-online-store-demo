// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fixture from '@/test/fixtures/postgres-tls.json'
import { createPostgresClient } from './client'

const testUrl = process.env.AI_TEST_POSTGRES_TLS_URL

describe.runIf(Boolean(testUrl))('real PostgreSQL verified TLS', () => {
  let directory: string
  let caFile: string

  beforeAll(() => {
    const url = new URL(testUrl!)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== 'localhost' ||
      !url.pathname.endsWith('_test') ||
      url.searchParams.has('options')
    ) {
      throw new Error('TLS integration requires a dedicated localhost PostgreSQL _test database')
    }
    directory = mkdtempSync(join(tmpdir(), 'evoloop-postgres-tls-'))
    caFile = join(directory, 'ca.pem')
    writeFileSync(caFile, fixture.cert)
  })

  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  async function query(trustFixture: boolean, wrongHostname = false) {
    const url = new URL(testUrl!)
    if (wrongHostname) url.hostname = '127.0.0.1'
    url.searchParams.set('connect_timeout', '3')
    const client = createPostgresClient(url.toString(), {
      NODE_ENV: 'production',
      PG_SSL_CA_FILE: trustFixture ? caFile : undefined,
    })
    try {
      return await client<{ ssl: boolean }[]>`
        SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()
      `
    } finally {
      await client.end({ timeout: 0 })
    }
  }

  it('refuses an untrusted database certificate in production', async () => {
    await expect(query(false)).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  })

  it('executes a real encrypted query with the trusted CA and matching hostname', async () => {
    await expect(query(true)).resolves.toMatchObject([{ ssl: true }])
  })

  it('refuses the trusted database certificate when the hostname does not match', async () => {
    await expect(query(true, true)).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    })
  })
})
