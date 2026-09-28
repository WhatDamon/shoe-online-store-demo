// @vitest-environment node
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type TLSSocket } from 'node:tls'
import { afterAll, describe, expect, it } from 'vitest'
import fixture from '@/test/fixtures/postgres-tls.json'
import { createPostgresClient } from './client'

const directory = mkdtempSync(join(tmpdir(), 'evoloop-handshake-'))
const caFile = join(directory, 'ca.pem')
writeFileSync(caFile, fixture.cert)
afterAll(() => rmSync(directory, { recursive: true, force: true }))

// A real TLS endpoint sends a recognizable PostgreSQL startup error only after
// the handshake. This tests the real driver/Node TLS boundary, not a mocked socket.
async function connect(host: string, trustFixture: boolean) {
  const sockets = new Set<TLSSocket>()
  const server = createServer({ key: fixture.key, cert: fixture.cert }, (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.once('data', () => {
      const body = Buffer.from('SFATAL\0CXX000\0Mtest_tls_verified\0\0')
      const header = Buffer.alloc(5)
      header[0] = 69 // PostgreSQL ErrorResponse. No real database or credentials.
      header.writeInt32BE(body.length + 4, 1)
      socket.end(Buffer.concat([header, body]))
    })
  })
  server.on('tlsClientError', (_error, socket) => socket.destroy())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  const client = createPostgresClient(
    `postgres://test:test@${host}:${port}/test?sslnegotiation=direct&connect_timeout=2`,
    {
      NODE_ENV: 'production',
      PG_SSL_CA_FILE: trustFixture ? caFile : undefined,
    },
  )
  try {
    await client`select 1`
  } finally {
    await client.end({ timeout: 0 })
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('verified PostgreSQL TLS handshake', () => {
  it('refuses an untrusted server certificate', async () => {
    await expect(connect('localhost', false)).rejects.toMatchObject({
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    })
  })

  it('accepts the explicitly trusted certificate with a matching hostname', async () => {
    await expect(connect('localhost', true)).rejects.toMatchObject({
      code: 'XX000',
      message: 'test_tls_verified',
    })
  })

  it('refuses a trusted certificate for the wrong hostname', async () => {
    await expect(connect('127.0.0.1', true)).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    })
  })
})
