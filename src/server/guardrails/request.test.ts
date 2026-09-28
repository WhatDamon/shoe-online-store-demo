import { describe, expect, it } from 'vitest'
import { AI_SESSION_COOKIE, requestIp, sessionIdFrom } from './request'

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
  it('issues a UUID when the request has no session cookie', () => {
    const session = sessionIdFrom(request())
    expect(session.issued).toBe(true)
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('replaces malformed cookies instead of accepting a client-chosen key', () => {
    const session = sessionIdFrom(request('rotate-me'))
    expect(session.issued).toBe(true)
    expect(session.id).not.toBe('rotate-me')
  })

  it('reuses a valid UUID cookie', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    expect(sessionIdFrom(request(id))).toEqual({ id, issued: false })
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
