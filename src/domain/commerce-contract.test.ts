import { describe, expect, it } from 'vitest'
import samples from '@/test/fixtures/commerce-responses.generated.json'
import openapi from '@/test/fixtures/commerce-openapi.generated.json'
import {
  parseCartView,
  parseCommerceProduct,
  parseOrderView,
  parsePaymentView,
} from './commerce-response'

const schemas = openapi.components.schemas

describe('Python to frontend response contract', () => {
  it('accepts every Python-validated sample and preserves consumed fields', () => {
    for (const product of samples.products) {
      expect(parseCommerceProduct(product).variants).toEqual(
        product.variants.map(({ id, color, size, price, currency, available }) => ({
          id,
          color,
          size,
          price,
          currency,
          available,
        })),
      )
    }
    for (const cart of samples.carts) {
      expect(parseCartView(cart)).toEqual({
        ...cart,
        items: cart.items.map(({ subtotal: _subtotal, ...item }) => item),
      })
    }
    for (const order of samples.orders) expect(parseOrderView(order)).toEqual(order)
    for (const payment of samples.payments) expect(parsePaymentView(payment)).toEqual(payment)
  })

  it('keeps the frontend state and payment allowlists aligned with Python schema', () => {
    expect(schemas.OrderResponse.properties.status.enum).toEqual(['pending_payment', 'cancelled'])
    expect(schemas.OrderResponse.properties.cancellation_reason.anyOf[0].enum).toEqual([
      'expired',
      'customer_cancelled',
    ])
    expect(schemas.OrderResponse.properties.payment_enabled.const).toBe(false)
    expect(schemas.PaymentResponse.properties.charged.const).toBe(false)
    expect(schemas.PaymentResponse.properties.provider.const).toBe('mock')
    expect(schemas.PaymentResponse.properties.code.const).toBe('payment_disabled')
    expect(schemas.OrderItemResponse.properties.quantity.minimum).toBe(1)
    expect(schemas.OrderItemResponse.properties.quantity.maximum).toBe(99)
  })

  it.each(['0.00', '1.01', '999999.99'])('accepts money allowed by Python: %s', (total) => {
    expect(new RegExp(schemas.CartResponse.properties.total.pattern).test(total)).toBe(true)
    expect(parseCartView({ ...samples.carts[0], total }).total).toBe(total)
  })

  it.each(['-1.00', '01.00', '1', '1.234', 'NaN', ' 1.00', '1.00\n'])(
    'rejects illegal money: %s',
    (total) => {
      expect(() => parseCartView({ ...samples.carts[0], total })).toThrow()
    },
  )

  it.each(['paid', 'refunded', null, ''])('rejects unsupported order status: %s', (status) => {
    expect(() => parseOrderView({ ...samples.orders[0], status })).toThrow()
  })

  it.each([
    { charged: true },
    { payment_enabled: true },
    { provider: 'live' },
    { order_status: 'paid' },
    { code: 'payment_success' },
    { order_id: 123 },
  ])('rejects unsafe payment responses: %j', (fields) => {
    expect(() => parsePaymentView({ ...samples.payments[0], ...fields })).toThrow()
  })

  it('strips internal payment fields and retains legacy cart compatibility', () => {
    expect(parsePaymentView({ ...samples.payments[0], internal_token: 'synthetic' })).toEqual(
      samples.payments[0],
    )
    const {
      available: _available,
      sellable: _sellable,
      subtotal: _subtotal,
      ...item
    } = samples.carts[1].items[0]
    expect(parseCartView({ ...samples.carts[1], items: [item] }).items).toEqual([item])
  })
})
