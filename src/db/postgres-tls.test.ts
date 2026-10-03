// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootCertificates } from 'node:tls'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createPostgresDb, pgConnectOptions } from './client'

vi.mock('postgres', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof postgres }>()
  return { ...actual, default: vi.fn(actual.default) }
})

const directory = mkdtempSync(join(tmpdir(), 'evoloop-tls-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('PostgreSQL TLS policy', () => {
  it.each([undefined, '', ' ', '1', 'true', 'require', 'verify-full'])(
    'verifies production certificates for PG_SSL=%s',
    (PG_SSL) => {
      expect(pgConnectOptions({ NODE_ENV: 'production', PG_SSL })).toEqual({
        rejectUnauthorized: true,
      })
    },
  )

  it.each(['0', 'false'])('refuses production plaintext (%s)', (PG_SSL) => {
    expect(() => pgConnectOptions({ NODE_ENV: 'production', PG_SSL })).toThrow(
      'PostgreSQL TLS cannot be disabled',
    )
    expect(pgConnectOptions({ NODE_ENV: 'development', PG_SSL })).toBeNull()
  })

  it.each(['production', ' Production ', 'PRODUCTION'])(
    'treats normalized production mode as TLS-required (%s)',
    (NODE_ENV) => {
      expect(() => pgConnectOptions({ NODE_ENV, PG_SSL: '0' })).toThrow(
        'PostgreSQL TLS cannot be disabled',
      )
    },
  )

  it('fails closed when the process-wide TLS escape hatch is enabled', () => {
    expect(() =>
      pgConnectOptions({
        NODE_ENV: ' production ',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow('NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed in production')
  })

  it('rejects unsupported modes without echoing configuration', () => {
    expect(() => pgConnectOptions({ PG_SSL: 'secret-invalid-value' })).toThrow(
      'Invalid PG_SSL: use 1/verify-full, or 0 for local development',
    )
  })

  it('loads an explicit trust bundle and keeps verification enabled', () => {
    const file = join(directory, 'ca.pem')
    const ca = rootCertificates[0]
    writeFileSync(file, ca)
    expect(pgConnectOptions({ PG_SSL_CA_FILE: file })).toEqual({
      rejectUnauthorized: true,
      ca,
    })
    expect(() => pgConnectOptions({ PG_SSL: '0', PG_SSL_CA_FILE: file })).toThrow(
      'PostgreSQL TLS cannot be disabled',
    )
  })

  it.each(['', 'not a certificate'])('refuses malformed CA contents (%s)', (contents) => {
    const file = join(directory, 'invalid.pem')
    writeFileSync(file, contents)
    expect(() => pgConnectOptions({ PG_SSL_CA_FILE: file })).toThrow(
      'PG_SSL_CA_FILE must contain a readable PEM certificate bundle',
    )
  })

  it('sanitizes missing-file errors before creating a connection', () => {
    vi.stubEnv('PG_SSL_CA_FILE', join(directory, 'missing-sensitive-path.pem'))
    expect(() => createPostgresDb('postgres://user:secret@localhost/test')).toThrow(
      'PG_SSL_CA_FILE must contain a readable PEM certificate bundle',
    )
    expect(postgres).not.toHaveBeenCalled()
  })

  it.each(['disable', 'require', 'prefer', 'allow'])(
    'prevents URL sslmode=%s and PGSSL from weakening production TLS',
    (mode) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('PG_SSL', '')
      vi.stubEnv('PG_SSL_CA_FILE', '')
      vi.stubEnv('PGSSL', 'require')
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '1')
      createPostgresDb(`postgres://user:secret@localhost/test?sslmode=${mode}`)
      // Inspect the real postgres.js parser's result, not just the arguments.
      const client = vi.mocked(postgres).mock.results.at(-1)!.value
      expect(client.options.ssl).toMatchObject({ rejectUnauthorized: true })
    },
  )
})
