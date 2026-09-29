import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_SESSION_COOKIE,
  AI_SESSION_MAX_AGE_SECONDS,
  requestIp,
  sessionIdFrom,
  SessionConfigurationError,
} from './request'

const signingKey = 'test-only-ai-session-key-not-for-deployment'
const now = new Date('2026-09-29T10:00:00Z')

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('AI_SESSION_SECRET', signingKey)
  vi.useFakeTimers()
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function request(cookie?: string, headers: Record<string, string> = {}) {
  return {
    cookies: {
      get: (name: string) =>
        name === AI_SESSION_COOKIE && cookie ? { name, value: cookie } : undefined,
    },
    headers: new Headers(headers),
  } as never
}

describe('server-owned AI session', () => {
  it('issues a random ID and a bounded signed cookie with a fixed expiry', () => {
    const session = sessionIdFrom(request())
    expect(session.issued).toBe(true)
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(session.cookieValue).not.toBe(session.id)
    expect(session.cookieValue).toMatch(/^v1[.][0-9a-f-]{36}[.][0-9]+[.][0-9a-f]{64}$/)
    expect(session.cookieValue.length).toBeLessThanOrEqual(160)
    expect(session.expiresAt).toBe(now.getTime() / 1000 + AI_SESSION_MAX_AGE_SECONDS)
  })

  it('replaces malformed cookies instead of accepting a client-chosen key', () => {
    const session = sessionIdFrom(request('rotate-me'))
    expect(session.issued).toBe(true)
    expect(session.id).not.toBe('rotate-me')
  })

  it('replaces a forged UUID cookie instead of treating its format as proof', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const session = sessionIdFrom(request(id))
    expect(session.issued).toBe(true)
    expect(session.id).not.toBe(id)
  })

  it('reuses a signed cookie without extending its original expiry', () => {
    const original = sessionIdFrom(request())
    vi.setSystemTime(now.getTime() + 5 * 60_000)
    expect(sessionIdFrom(request(original.cookieValue))).toEqual({ ...original, issued: false })
  })

  it('rejects a different UUID with the original signature', () => {
    const original = sessionIdFrom(request())
    const forged = original.cookieValue.replace(original.id, '123e4567-e89b-42d3-a456-426614174000')
    expect(sessionIdFrom(request(forged)).issued).toBe(true)
  })

  it('rejects a modified expiry even when it is inside the allowed lifetime', () => {
    const original = sessionIdFrom(request())
    const forged = original.cookieValue.replace(
      String(original.expiresAt),
      String(original.expiresAt - 1),
    )
    expect(sessionIdFrom(request(forged)).issued).toBe(true)
  })

  it('rejects a signature changed by one character', () => {
    const original = sessionIdFrom(request())
    const forged =
      original.cookieValue.slice(0, -1) + (original.cookieValue.endsWith('0') ? '1' : '0')
    expect(sessionIdFrom(request(forged)).issued).toBe(true)
  })

  it('rejects signatures from a different or rotated key', () => {
    const original = sessionIdFrom(request())
    vi.stubEnv('AI_SESSION_SECRET', 'another-test-only-key-not-for-deployment')
    const replacement = sessionIdFrom(request(original.cookieValue))
    expect(replacement.issued).toBe(true)
    expect(replacement.id).not.toBe(original.id)
  })

  it('rejects alternate separators even with an otherwise valid signature', () => {
    const original = sessionIdFrom(request())
    const noncanonical = original.cookieValue.replaceAll('.', '_')
    expect(sessionIdFrom(request(noncanonical)).issued).toBe(true)
  })

  it('expires at the server deadline even if a client retains the cookie', () => {
    const original = sessionIdFrom(request())
    vi.setSystemTime(original.expiresAt * 1000 - 1)
    expect(sessionIdFrom(request(original.cookieValue)).issued).toBe(false)
    vi.setSystemTime(original.expiresAt * 1000)
    const replacement = sessionIdFrom(request(original.cookieValue))
    expect(replacement.issued).toBe(true)
    expect(replacement.id).not.toBe(original.id)
  })

  it('rejects a signed cookie issued in the future', () => {
    const original = sessionIdFrom(request())
    vi.setSystemTime(now.getTime() - 1000)
    expect(sessionIdFrom(request(original.cookieValue)).issued).toBe(true)
  })

  it.each(['x'.repeat(4096), 'v1.invalid', 'v2.invalid', 'v1.id.NaN.00', '%00'])(
    'safely replaces malformed cookies (%#)',
    (value) => {
      expect(sessionIdFrom(request(value)).issued).toBe(true)
    },
  )

  it.each([undefined, '', ' ', 'too-short'])('requires a valid production key (%#)', (secret) => {
    expect(() =>
      sessionIdFrom(request(), { env: { NODE_ENV: 'production', AI_SESSION_SECRET: secret } }),
    ).toThrow(SessionConfigurationError)
  })

  it('does not enable the development fallback in an unspecified environment', () => {
    expect(() => sessionIdFrom(request(), { env: {} })).toThrow(SessionConfigurationError)
  })

  it('uses one ephemeral key across local development requests', () => {
    const options = { env: { NODE_ENV: 'development' } }
    const original = sessionIdFrom(request(), options)
    expect(sessionIdFrom(request(original.cookieValue), options).id).toBe(original.id)
  })

  it('rejects an explicitly weak development key', () => {
    expect(() =>
      sessionIdFrom(request(), { env: { NODE_ENV: 'development', AI_SESSION_SECRET: 'short' } }),
    ).toThrow(SessionConfigurationError)
  })
})

describe('requestIp', () => {
  it('ignores a forged forwarding header by default', () => {
    expect(requestIp({ headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }) })).toBe(
      'untrusted',
    )
  })

  it('uses the direct peer when it is not a trusted proxy', () => {
    expect(
      requestIp(
        { ip: '192.0.2.10', headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }) },
        { TRUSTED_PROXY_IPS: '192.0.2.11' },
      ),
    ).toBe('192.0.2.10')
  })

  it('uses the first forwarded address only for an exact trusted peer', () => {
    expect(
      requestIp(
        {
          ip: '192.0.2.10',
          headers: new Headers({ 'x-forwarded-for': '203.0.113.9, 192.0.2.10' }),
        },
        { TRUSTED_PROXY_IPS: '192.0.2.10' },
      ),
    ).toBe('203.0.113.9')
  })

  it('falls back to one bounded bucket when the runtime hides the peer', () => {
    expect(requestIp({ headers: new Headers() }, { TRUSTED_PROXY_IPS: '192.0.2.10' })).toBe(
      'untrusted',
    )
  })
})
