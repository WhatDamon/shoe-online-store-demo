import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

afterEach(() => vi.unstubAllGlobals())
it('preserves server error status without forwarding internal diagnostics', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('database password=private', { status: 500 })),
  )
  const response = await GET(new NextRequest('http://localhost:3000/api/commerce/cart'), {
    params: Promise.resolve({ path: ['cart'] }),
  })
  expect(response.status).toBe(500)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    code: 'backend_unavailable',
    detail: 'backend_unavailable',
  })
})
it('accepts the browser host when Next internally normalizes the URL to localhost', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"items":[]}'))
  vi.stubGlobal('fetch', fetcher)
  const req = new NextRequest('http://localhost:3000/api/commerce/cart/items', {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
  })
  expect((await POST(req, { params: Promise.resolve({ path: ['cart', 'items'] }) })).status).toBe(
    200,
  )
})
it('sets a private no-store session cookie and forwards only the trusted session', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"items":[]}'))
  vi.stubGlobal('fetch', fetcher)
  const response = await GET(
    new NextRequest('http://localhost:3000/api/commerce/cart', {
      headers: { 'X-Session-ID': 'spoof' },
    }),
    { params: Promise.resolve({ path: ['cart'] }) },
  )
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(response.headers.get('set-cookie')).toContain('SameSite=lax')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(fetcher.mock.calls[0][1].headers['X-Session-ID']).not.toBe('spoof')
})
it('rejects cross-origin writes and arbitrary upstream paths', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const req = new NextRequest('http://localhost:3000/api/commerce/cart/items', {
    method: 'POST',
    headers: { origin: 'https://attacker.example' },
  })
  expect((await POST(req, { params: Promise.resolve({ path: ['cart', 'items'] }) })).status).toBe(
    403,
  )
  expect((await GET(req, { params: Promise.resolve({ path: ['admin'] }) })).status).toBe(404)
  expect(fetcher).not.toHaveBeenCalled()
})
it('preserves session and idempotency key across a retry and reports outages', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetcher)
  const sid = crypto.randomUUID()
  const req = new NextRequest('http://localhost:3000/api/commerce/checkout/create-order', {
    method: 'POST',
    headers: { cookie: `evoloop_cart_session=${sid}`, 'Idempotency-Key': 'same-key' },
  })
  const response = await POST(req, {
    params: Promise.resolve({ path: ['checkout', 'create-order'] }),
  })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    code: 'backend_unavailable',
    detail: 'backend_unavailable',
  })
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({
    'X-Session-ID': sid,
    'Idempotency-Key': 'same-key',
  })
  expect(response.headers.get('set-cookie')).toBeNull()
})

it('owns request correlation and forwards it without trusting a browser header', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')))
  vi.stubGlobal('fetch', fetcher)
  const publicId = crypto.randomUUID()
  const request = () =>
    new NextRequest('http://localhost:3000/api/commerce/cart', {
      headers: { 'X-Request-ID': publicId },
    })
  const first = await GET(request(), { params: Promise.resolve({ path: ['cart'] }) })
  const second = await GET(request(), { params: Promise.resolve({ path: ['cart'] }) })
  const traceId = first.headers.get('x-request-id')
  expect(traceId).toMatch(/^[0-9a-f-]{36}$/)
  expect(traceId).not.toBe(publicId)
  expect(second.headers.get('x-request-id')).not.toBe(traceId)
  expect(fetcher.mock.calls[0][1].headers['X-Request-ID']).toBe(traceId)
})

it('includes safe codes and correlation even when rejecting before an upstream call', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const req = new NextRequest('http://localhost:3000/api/commerce/cart/items', {
    method: 'POST',
    headers: { origin: 'https://untrusted.example' },
  })
  const forbidden = await POST(req, { params: Promise.resolve({ path: ['cart', 'items'] }) })
  const missing = await GET(req, { params: Promise.resolve({ path: ['admin'] }) })
  expect(await forbidden.json()).toEqual({ code: 'invalid_origin', detail: 'invalid_origin' })
  expect(await missing.json()).toEqual({ code: 'not_found', detail: 'not_found' })
  for (const response of [forbidden, missing]) {
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  }
  expect(fetcher).not.toHaveBeenCalled()
})
