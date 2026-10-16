import { describe, expect, it } from 'vitest'
import { parseOrderView, parsePaymentSessionView } from './commerce-response'

/** The exact order shape the Python `order_view` returns today. */
const ORDER = {
  id: '8f14e45f-ceea-467a-9e4f-1a2b3c4d5e6f',
  status: 'pending_payment',
  expires_at: '2026-10-13T12:00:00Z',
  cancellation_reason: null,
  payment_enabled: false,
  payment_status: null,
  message: 'Payments are not available yet.',
  items: [],
  total: '0.00',
  currency: 'USD',
}

describe('parseOrderView', () => {
  it('accepts the pending shape returned today', () => {
    expect(parseOrderView(ORDER).status).toBe('pending_payment')
    expect(parseOrderView(ORDER).payment_status).toBeNull()
  })

  it('accepts paid and refunded statuses', () => {
    expect(parseOrderView({ ...ORDER, status: 'paid' }).status).toBe('paid')
    expect(parseOrderView({ ...ORDER, status: 'refunded' }).status).toBe('refunded')
    expect(parseOrderView({ ...ORDER, status: 'cancelled' }).status).toBe('cancelled')
  })

  it('rejects an unknown status', () => {
    // The "reject unknown values" defence is an asset; it must not decay to `text()`.
    expect(() => parseOrderView({ ...ORDER, status: 'shipped' })).toThrow()
    expect(() => parseOrderView({ ...ORDER, status: '' })).toThrow()
  })

  it('accepts payment_enabled true', () => {
    expect(parseOrderView({ ...ORDER, payment_enabled: true }).payment_enabled).toBe(true)
  })

  it('rejects a non-boolean payment_enabled', () => {
    expect(() => parseOrderView({ ...ORDER, payment_enabled: 'true' })).toThrow()
    expect(() => parseOrderView({ ...ORDER, payment_enabled: false })).toBeTruthy()
  })

  it('accepts every funds-axis value the backend can return', () => {
    for (const payment of [
      'disabled',
      'requires_payment',
      'succeeded',
      'refund_pending',
      'refunded',
    ]) {
      expect(parseOrderView({ ...ORDER, payment_status: payment }).payment_status).toBe(payment)
    }
  })

  it('rejects an unknown payment_status and a missing one', () => {
    expect(() => parseOrderView({ ...ORDER, payment_status: 'captured' })).toThrow()
    const { payment_status: _omitted, ...withoutPaymentStatus } = ORDER
    expect(() => parseOrderView(withoutPaymentStatus)).toThrow()
  })

  it('ignores unknown extra fields', () => {
    // Pins review focus 3: a stale cached response may still carry removed fields.
    const parsed = parseOrderView({ ...ORDER, storeAvailable: true, somethingNew: 1 })
    expect(parsed).not.toHaveProperty('storeAvailable')
    expect(parsed).not.toHaveProperty('somethingNew')
  })
})

/** The exact payments/session shape the disabled path returns today. */
const DISABLED_SESSION = {
  code: 'payment_disabled',
  payment_enabled: false,
  provider: 'mock',
  order_id: ORDER.id,
  order_status: 'pending_payment',
  redirect_url: null,
  message: 'Payments are not available yet.',
}

describe('parsePaymentSessionView', () => {
  it('accepts the disabled shape returned today', () => {
    expect(parsePaymentSessionView(DISABLED_SESSION).code).toBe('payment_disabled')
    expect(parsePaymentSessionView(DISABLED_SESSION).redirect_url).toBeNull()
  })

  it('tolerates a serializer that omits the null redirect_url', () => {
    const { redirect_url: _omitted, ...withoutRedirect } = DISABLED_SESSION
    expect(parsePaymentSessionView(withoutRedirect).redirect_url).toBeNull()
  })

  it('requires redirect_url when code is payment_ready', () => {
    const ready = {
      ...DISABLED_SESSION,
      code: 'payment_ready',
      payment_enabled: true,
      provider: 'stripe',
    }
    expect(
      parsePaymentSessionView({ ...ready, redirect_url: 'https://checkout.stripe.com/c/pay/x' })
        .code,
    ).toBe('payment_ready')
    expect(() => parsePaymentSessionView(ready)).toThrow()
    expect(() => parsePaymentSessionView({ ...ready, redirect_url: '' })).toThrow()
    expect(() => parsePaymentSessionView({ ...ready, redirect_url: 'not-a-url' })).toThrow()
  })

  it('rejects redirect_url when code is payment_disabled', () => {
    expect(() =>
      parsePaymentSessionView({ ...DISABLED_SESSION, redirect_url: 'https://evil.test/x' }),
    ).toThrow()
  })

  it('rejects unknown codes, providers and order statuses', () => {
    expect(() => parsePaymentSessionView({ ...DISABLED_SESSION, code: 'paid' })).toThrow()
    expect(() => parsePaymentSessionView({ ...DISABLED_SESSION, provider: 'paypal' })).toThrow()
    expect(() =>
      parsePaymentSessionView({ ...DISABLED_SESSION, order_status: 'shipped' }),
    ).toThrow()
  })

  it('accepts the other non-ready outcome codes', () => {
    for (const code of ['order_not_payable', 'currency_unsupported']) {
      expect(parsePaymentSessionView({ ...DISABLED_SESSION, code }).code).toBe(code)
    }
  })
})
