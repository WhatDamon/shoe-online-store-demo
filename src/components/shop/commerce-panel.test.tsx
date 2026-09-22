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
  message: 'Payments are not available yet.',
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
