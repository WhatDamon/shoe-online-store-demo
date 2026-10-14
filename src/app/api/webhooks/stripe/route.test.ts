import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const SECRET = 'whsec_test_secret'
const PROXY = 'p'.repeat(40)

const SESSION = {
  id: 'cs_test_a1',
  object: 'checkout.session',
  client_reference_id: '8f14e45f-ceea-467a-9e4f-1a2b3c4d5e6f',
  payment_intent: 'pi_test_a1',
  amount_total: 5900,
  currency: 'usd',
  payment_status: 'paid',
  customer_email: 'buyer@example.com',
  customer_details: { email: 'buyer@example.com', name: 'Ada Lovelace' },
}
const EVENT = {
  id: 'evt_test_a1',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: SESSION },
}

function signature(
  payload: string,
  options: { timestamp?: number; secret?: string; v1?: string } = {},
) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const digest = crypto
    .createHmac('sha256', options.secret ?? SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return `t=${timestamp},v1=${options.v1 ?? digest}`
}

function request(event: unknown, header?: string) {
  return new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    body: JSON.stringify(event),
    headers: header === undefined ? {} : { 'stripe-signature': header },
  })
}

const forwarded = (fetcher: ReturnType<typeof vi.fn>) =>
  JSON.parse(fetcher.mock.calls[0][1].body as string)

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('COMMERCE_PROXY_SECRET', PROXY)
  vi.stubEnv('PYTHON_API_URL', 'http://127.0.0.1:8000')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('stripe webhook ingress', () => {
  it('rejects a request without a signature and never forwards it', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect((await POST(request(EVENT))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a request with a wrong signature and never forwards it', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const payload = JSON.stringify(EVENT)
    expect((await POST(request(EVENT, signature(payload, { secret: 'whsec_wrong' })))).status).toBe(
      400,
    )
    expect((await POST(request(EVENT, signature(payload, { v1: 'deadbeef' })))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a stale timestamp outside the tolerance window', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const payload = JSON.stringify(EVENT)
    const stale = Math.floor(Date.now() / 1000) - 60 * 60
    expect((await POST(request(EVENT, signature(payload, { timestamp: stale })))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed when the webhook secret is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const payload = JSON.stringify(EVENT)
    expect((await POST(request(EVENT, signature(payload)))).status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('forwards only the minimal projection when the signature is valid', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    expect((await POST(request(EVENT, signature(JSON.stringify(EVENT))))).status).toBe(200)

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/api/v1/webhooks/stripe')
    expect(init.headers['X-Internal-Proxy-Secret']).toBe(PROXY)
    expect(init.headers['X-Request-ID']).toBeTruthy()
    expect(forwarded(fetcher)).toEqual({
      id: 'evt_test_a1',
      type: 'checkout.session.completed',
      payment_status: 'paid',
      order_id: '8f14e45f-ceea-467a-9e4f-1a2b3c4d5e6f',
      checkout_session_id: 'cs_test_a1',
      payment_intent: 'pi_test_a1',
      amount_total: 5900,
      currency: 'usd',
    })
  })

  it('does not pass through raw payload fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await POST(request(EVENT, signature(JSON.stringify(EVENT))))

    const body = JSON.stringify(forwarded(fetcher))
    expect(body).not.toContain('buyer@example.com')
    expect(body).not.toContain('Ada Lovelace')
    expect(body).not.toContain('customer_details')
    expect(Object.keys(forwarded(fetcher)).sort()).toEqual(
      [
        'amount_total',
        'checkout_session_id',
        'currency',
        'id',
        'order_id',
        'payment_intent',
        'payment_status',
        'type',
      ].sort(),
    )
  })

  it('returns the upstream status so Stripe retries a failure', async () => {
    // Deliberately the opposite of the commerce proxy, which folds 5xx into backend_unavailable.
    const failing = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', failing)
    expect((await POST(request(EVENT, signature(JSON.stringify(EVENT))))).status).toBe(500)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect((await POST(request(EVENT, signature(JSON.stringify(EVENT))))).status).toBe(502)
  })

  it('ignores event types it cannot project instead of forwarding a broken body', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const other = { id: 'evt_other', type: 'charge.refunded', data: { object: { id: 'ch_1' } } }
    expect((await POST(request(other, signature(JSON.stringify(other))))).status).toBe(200)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
