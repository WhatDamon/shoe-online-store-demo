import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CommercePanel } from './commerce-panel'

const line = {
  id: 'item-1',
  variant_id: 'variant-1',
  title: 'Urban Bloom',
  sku: 'SKU',
  color: 'Ivory',
  size: 42,
  quantity: 1,
  unit_price: '59.00',
}
const cart = { items: [line], total: '59.00', currency: 'USD' }
const order = {
  ...cart,
  id: 'order-1',
  status: 'pending_payment',
  payment_enabled: false,
  payment_status: null,
  message: 'Payments are not available yet.',
  expires_at: '2026-09-21T14:30:00+00:00',
  cancellation_reason: null,
}
const ok = (data: unknown) => ({ ok: true, json: async () => data })
beforeEach(() => sessionStorage.clear())
afterEach(() => vi.unstubAllGlobals())

it('changes cart quantity using the backend total and removes an item', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(cart))
    .mockResolvedValueOnce(ok({ ...cart, items: [{ ...line, quantity: 2 }], total: '118.00' }))
    .mockResolvedValueOnce(ok({ ...cart, items: [], total: '0.00' }))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="cart" />)
  fireEvent.change(await screen.findByLabelText('Urban Bloom quantity'), { target: { value: '2' } })
  expect(await screen.findByText('Total: USD 118.00')).toBeInTheDocument()
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/commerce/cart/items/item-1',
    expect.objectContaining({ method: 'PATCH', body: '{"quantity":2}' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Remove Urban Bloom' }))
  expect(await screen.findByText('Your cart is empty.')).toBeInTheDocument()
})

it('blocks checkout for an unavailable line and restores checkout after removing it', async () => {
  const unavailable = { ...line, sellable: false, available: 10 }
  const active = {
    ...line,
    id: 'item-2',
    variant_id: 'variant-2',
    title: 'Coastal Run',
    sellable: true,
    available: 10,
  }
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok({ ...cart, items: [unavailable, active], total: '118.00' }))
    .mockResolvedValueOnce(ok({ ...cart, items: [active] }))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="cart" />)
  expect(
    await screen.findByText('No longer available. Remove this item to continue.'),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Urban Bloom quantity')).toBeDisabled()
  expect(screen.getByLabelText('Coastal Run quantity')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Remove Urban Bloom' })).toBeEnabled()
  expect(screen.queryByRole('link', { name: 'Review checkout' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Urban Bloom' }))
  expect(await screen.findByRole('link', { name: 'Review checkout' })).toHaveAttribute(
    'href',
    '/checkout',
  )
  expect(screen.queryByText('Urban Bloom')).not.toBeInTheDocument()
  expect(screen.getByText('Coastal Run')).toBeInTheDocument()
  expect(screen.getByText('Total: USD 59.00')).toBeInTheDocument()
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/commerce/cart/items/item-1',
    expect.objectContaining({ method: 'DELETE' }),
  )
})

it('does not create an order from a preview containing an unavailable line', async () => {
  const fetcher = vi.fn().mockResolvedValue(ok({ ...cart, items: [{ ...line, sellable: false }] }))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  await screen.findByText('No longer available. Remove this item to continue.')
  const create = screen.getByRole('button', { name: 'Create pending order' })
  expect(create).toBeDisabled()
  fireEvent.click(create)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(sessionStorage.getItem('evoloop-pending-checkout')).toBeNull()
})

it('explains an unavailable preview and blocks a fresh order request', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ code: 'variant_unavailable', message: 'private backend message' }),
  })
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This item is no longer available. Remove it from your cart to continue.',
  )
  expect(screen.getByRole('button', { name: 'Create pending order' })).toBeDisabled()
  expect(screen.getByRole('link', { name: 'Back to cart' })).toHaveAttribute('href', '/cart')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('replays the saved checkout key after a variant becomes unavailable in preview', async () => {
  const savedKey = 'pending-order-request'
  sessionStorage.setItem('evoloop-pending-checkout', savedKey)
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ code: 'variant_unavailable' }),
    })
    .mockResolvedValueOnce(ok(order))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  await screen.findByRole('alert')
  const retry = screen.getByRole('button', { name: 'Retry order request' })
  expect(retry).toBeEnabled()
  expect(sessionStorage.getItem('evoloop-pending-checkout')).toBe(savedKey)
  fireEvent.click(retry)
  await screen.findByText('Order ID: order-1')
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/commerce/checkout/create-order',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': savedKey }),
    }),
  )
  expect(sessionStorage.getItem('evoloop-pending-checkout')).toBeNull()
})

it('creates pending order, shows payment disabled and supports cancellation', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(cart))
    .mockResolvedValueOnce(ok(order))
    .mockResolvedValueOnce(ok({ ...order, status: 'cancelled' }))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  await screen.findByText('Urban Bloom')
  fireEvent.click(screen.getByRole('button', { name: 'Create pending order' }))
  expect(await screen.findByText('Order ID: order-1')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Payments are not available yet.')
  expect(screen.getByText('Status: Pending payment')).toBeInTheDocument()
  const request = fetcher.mock.calls[1][1]
  expect(request.headers['Idempotency-Key']).toBeTruthy()
  expect(request.body).toBeUndefined()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel order and release inventory' }))
  expect(await screen.findByText('Status: Cancelled')).toBeInTheDocument()
})

it('keeps the same idempotency key after an ambiguous network failure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(cart))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(ok(order))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  await screen.findByText('Urban Bloom')
  fireEvent.click(screen.getByRole('button', { name: 'Create pending order' }))
  await screen.findByText('offline')
  fireEvent.click(screen.getByRole('button', { name: 'Retry order request' }))
  await screen.findByText('Order ID: order-1')
  expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(
    fetcher.mock.calls[2][1].headers['Idempotency-Key'],
  )
  await waitFor(() => expect(sessionStorage.getItem('evoloop-pending-checkout')).toBeNull())
})

it('shows the reservation deadline and refreshes to expired without enabling payment', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(order))
    .mockResolvedValueOnce(
      ok({
        ...order,
        status: 'cancelled',
        cancellation_reason: 'expired',
      }),
    )
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<CommercePanel mode="order" orderId="order-1" />)
  await screen.findByText('Status: Pending payment')
  expect(container.querySelector('time')).toHaveAttribute('dateTime', order.expires_at)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh order status' }))
  expect(await screen.findByText('Status: Expired')).toBeInTheDocument()
  expect(screen.getByText(/Inventory has been released/)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Payments are not available yet.')
  expect(
    screen.queryByRole('button', { name: 'Cancel order and release inventory' }),
  ).not.toBeInTheDocument()
})

it('renders historical cancelled orders with no reservation deadline', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(ok({ ...order, status: 'cancelled', expires_at: null })),
  )
  const { container } = render(<CommercePanel mode="order" orderId="order-1" />)
  await screen.findByText('Status: Cancelled')
  expect(container.querySelector('time')).toBeNull()
  expect(screen.getByText(/Inventory has been released/)).toBeInTheDocument()
})

it('keeps the checkout key when a successful HTTP response has an invalid order', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(cart))
    .mockResolvedValueOnce(ok({ ...order, status: 'shipped' }))
    .mockResolvedValueOnce(ok(order))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  await screen.findByText('Urban Bloom')
  fireEvent.click(screen.getByRole('button', { name: 'Create pending order' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid response')
  expect(screen.queryByText('Order ID: order-1')).not.toBeInTheDocument()
  expect(sessionStorage.getItem('evoloop-pending-checkout')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry order request' }))
  await screen.findByText('Order ID: order-1')
  expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(
    fetcher.mock.calls[2][1].headers['Idempotency-Key'],
  )
  expect(sessionStorage.getItem('evoloop-pending-checkout')).toBeNull()
})

const payable = { ...order, payment_enabled: true, payment_status: null }

function stubAssign() {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  })
  return assign
}

it('shows a pay button only when payments are enabled and the order is pending', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(payable)))
  render(<CommercePanel mode="order" orderId="order-1" />)
  expect(await screen.findByRole('button', { name: 'Pay now' })).toBeInTheDocument()
})

it('does not show a pay button when payments are disabled', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(order)))
  render(<CommercePanel mode="order" orderId="order-1" />)
  await screen.findByText('Order ID: order-1')
  expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
})

it('redirects to the checkout url the session returns', async () => {
  const assign = stubAssign()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(payable))
    .mockResolvedValueOnce(
      ok({
        code: 'payment_ready',
        payment_enabled: true,
        provider: 'stripe',
        order_id: 'order-1',
        order_status: 'pending_payment',
        redirect_url: 'https://checkout.stripe.com/c/pay/cs_test_a1',
        message: 'Redirecting to the payment page.',
      }),
    )
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="order" orderId="order-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Pay now' }))
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_a1'),
  )
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/commerce/payments/session',
    expect.objectContaining({ method: 'POST', body: '{"order_id":"order-1"}' }),
  )
})

it('explains a non-payable outcome instead of redirecting', async () => {
  const assign = stubAssign()
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(ok(payable))
      .mockResolvedValueOnce(
        ok({
          code: 'order_not_payable',
          payment_enabled: true,
          provider: 'stripe',
          order_id: 'order-1',
          order_status: 'pending_payment',
          redirect_url: null,
          message: 'This order can no longer be paid for.',
        }),
      ),
  )
  render(<CommercePanel mode="order" orderId="order-1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Pay now' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'This order can no longer be paid for.',
  )
  expect(assign).not.toHaveBeenCalled()
})

it('never claims the order is paid from the success query parameter', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(payable)))
  render(<CommercePanel mode="order" orderId="order-1" paymentNotice="success" />)
  await screen.findByText('Order ID: order-1')
  // The query parameter is forgeable, so the page must read the truth instead of echoing it.
  expect(screen.getByText('Status: Pending payment')).toBeInTheDocument()
  expect(screen.queryByText(/Payment received/i)).not.toBeInTheDocument()
  expect(screen.getByText(/We haven't received a payment for this order yet/i)).toBeInTheDocument()
})

it('shows the paid state from the order itself', async () => {
  const paid = { ...payable, status: 'paid', payment_status: 'succeeded', expires_at: null }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(paid)))
  render(<CommercePanel mode="order" orderId="order-1" paymentNotice="success" />)
  expect(await screen.findByText('Status: Paid')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
})

it('shows the refunded state and the refund-in-progress state separately', async () => {
  const refunding = {
    ...payable,
    status: 'paid',
    payment_status: 'refund_pending',
    expires_at: null,
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(refunding)))
  const first = render(<CommercePanel mode="order" orderId="order-1" />)
  expect(await screen.findByText(/refund for this order is being processed/i)).toBeInTheDocument()
  first.unmount()

  const refunded = { ...payable, status: 'refunded', payment_status: 'refunded', expires_at: null }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(refunded)))
  render(<CommercePanel mode="order" orderId="order-1" />)
  expect(await screen.findByText('Status: Refunded')).toBeInTheDocument()
  expect(screen.queryByText(/being processed/i)).not.toBeInTheDocument()
})

it('reports a paid order that can no longer be cancelled', async () => {
  const paid = { ...payable, status: 'paid', payment_status: 'succeeded', expires_at: null }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(paid)))
  render(<CommercePanel mode="order" orderId="order-1" />)
  await screen.findByText('Status: Paid')
  expect(
    screen.queryByRole('button', { name: 'Cancel order and release inventory' }),
  ).not.toBeInTheDocument()
})
