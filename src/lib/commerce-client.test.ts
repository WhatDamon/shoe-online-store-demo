import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCartView, parseCommerceProduct, parseOrderView } from '@/domain/commerce-response'
import { messages } from '@/i18n/messages'
import { commerceRequest } from './commerce-client'

const line = {
  id: 'item-1',
  variant_id: 'variant-1',
  title: 'Urban Bloom',
  sku: 'SKU',
  color: 'Ivory',
  size: 42,
  quantity: 1,
  unit_price: '59.00',
  available: 10,
}
const cart = { items: [line], total: '59.00', currency: 'USD' }
const order = {
  ...cart,
  id: 'order-1',
  status: 'pending_payment',
  payment_enabled: false,
  expires_at: null,
  cancellation_reason: null,
  message: 'Payments are not available yet.',
}
const variant = {
  id: 'variant-1',
  color: 'Ivory',
  size: 42,
  price: '59.00',
  currency: 'USD',
  available: 10,
}
const ok = (data: unknown) => ({ ok: true, json: async () => data })
const invalidMessage = 'The shopping service returned an invalid response. Please try again.'
afterEach(() => vi.unstubAllGlobals())

it('validates cart data, strips internal fields and preserves request options', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    ok({
      ...cart,
      session_id: 'secret',
      items: [{ ...line, internal_token: 'secret' }],
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(commerceRequest('cart', parseCartView, { method: 'GET' })).resolves.toEqual(cart)
  expect(fetcher).toHaveBeenCalledWith(
    '/api/commerce/cart',
    expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }),
  )
})

it('accepts null legacy deadlines and explicitly cancelled orders', () => {
  expect(parseOrderView(order)).toEqual(order)
  expect(
    parseOrderView({ ...order, status: 'cancelled', cancellation_reason: 'expired' }).status,
  ).toBe('cancelled')
  expect(parseCommerceProduct({ variants: [variant] })).toEqual({ variants: [variant] })
})

it.each([true, false])('preserves explicit sellable=%s in cart and order responses', (sellable) => {
  const items = [{ ...line, sellable }]
  expect(parseCartView({ ...cart, items })).toEqual({ ...cart, items })
  expect(parseOrderView({ ...order, items })).toEqual({ ...order, items })
})

it('accepts legacy cart and order lines without inventing a sellable field', () => {
  expect(parseCartView(cart).items[0]).not.toHaveProperty('sellable')
  expect(parseOrderView(order).items[0]).not.toHaveProperty('sellable')
})

const invalidCases: [string, (value: unknown) => unknown, unknown][] = [
  ['null cart', parseCartView, null],
  ['non-array items', parseCartView, { ...cart, items: {} }],
  ['numeric total', parseCartView, { ...cart, total: 59 }],
  ['fractional cents', parseCartView, { ...cart, total: '59.001' }],
  ['negative money', parseCartView, { ...cart, total: '-1.00' }],
  ['newline money', parseCartView, { ...cart, total: '59.00\n' }],
  ['invalid currency', parseCartView, { ...cart, currency: 'usd' }],
  ['newline currency', parseCartView, { ...cart, currency: 'USD\n' }],
  ['string quantity', parseCartView, { ...cart, items: [{ ...line, quantity: '1' }] }],
  ['excess quantity', parseCartView, { ...cart, items: [{ ...line, quantity: 100 }] }],
  ['null line', parseCartView, { ...cart, items: [null] }],
  ['string sellable', parseCartView, { ...cart, items: [{ ...line, sellable: 'false' }] }],
  ['numeric sellable', parseCartView, { ...cart, items: [{ ...line, sellable: 0 }] }],
  ['null sellable', parseCartView, { ...cart, items: [{ ...line, sellable: null }] }],
  ['array sellable', parseCartView, { ...cart, items: [{ ...line, sellable: [] }] }],
  ['object sellable', parseOrderView, { ...order, items: [{ ...line, sellable: {} }] }],
  ['invalid stock', parseCommerceProduct, { variants: [{ ...variant, available: -1 }] }],
  ['numeric price', parseCommerceProduct, { variants: [{ ...variant, price: 59 }] }],
  ['paid order', parseOrderView, { ...order, status: 'paid' }],
  ['enabled payments', parseOrderView, { ...order, payment_enabled: true }],
  ['missing deadline', parseOrderView, { ...order, expires_at: undefined }],
  ['invalid deadline', parseOrderView, { ...order, expires_at: 'not-a-date' }],
  ['timezone-free deadline', parseOrderView, { ...order, expires_at: '2026-09-30T12:00:00' }],
]
it.each(invalidCases)('rejects %s before it reaches UI state', async (_name, parse, data) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(data)))
  await expect(commerceRequest('test', parse)).rejects.toThrow(invalidMessage)
})

it('does not expose parser errors or non-JSON upstream bodies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('private upstream body')
      },
    }),
  )
  await expect(commerceRequest('cart', parseCartView)).rejects.toThrow(invalidMessage)
})

it.each([null, [], { detail: [] }, { code: '__proto__' }, { code: 'unknown', message: 'secret' }])(
  'handles unrecognized error envelopes safely: %j',
  async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => data }))
    await expect(commerceRequest('cart', parseCartView)).rejects.toThrow(
      "We couldn't complete that action. Check the quantity and try again.",
    )
  },
)

it.each([{ detail: 'insufficient_stock' }, { code: 'insufficient_stock', message: 'secret' }])(
  'preserves legacy and structured error codes: %j',
  async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => data }))
    await expect(commerceRequest('cart', parseCartView)).rejects.toThrow(
      'Not enough stock. Update the quantity in your cart.',
    )
  },
)

it.each([{ detail: 'variant_unavailable' }, { code: 'variant_unavailable', message: 'secret' }])(
  'shows a safe removal message for unavailable variants: %j',
  async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => data }))
    await expect(commerceRequest('checkout/preview', parseCartView)).rejects.toThrow(
      'This item is no longer available. Remove it from your cart to continue.',
    )
  },
)

// 错误码是 snake_case（跨语言机器契约，不改名），词典键的叶子不允许下划线
// （`src/i18n/messages.test.ts` 的键名守卫），故两者由 `commerce-client.ts` 的显式映射连接。
// 这里逐条钉住映射两侧，再用真实请求路径证明每个码真的取到了它自己的文案——映射少一条就会
// 落到 generic 兜底串，第二条断言即红（不会静默渲染出 `undefined`）。
const localizedErrors = [
  ['variant_unavailable', 'errors.variantUnavailable'],
  ['insufficient_stock', 'errors.insufficientStock'],
  ['empty_cart', 'errors.emptyCart'],
  ['order_not_found', 'errors.orderNotFound'],
  ['backend_unavailable', 'errors.backendUnavailable'],
] as const

describe('commerce 错误文案本地化', () => {
  it.each(localizedErrors)('%s 在词典里有文案', (_code, key) => {
    expect(typeof messages('en')[key]).toBe('string')
  })

  it.each(localizedErrors)('%s 的响应带着该文案报错', async (code, key) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code }) }))
    await expect(commerceRequest('cart', parseCartView)).rejects.toThrowError(
      new Error(messages('en')[key]),
    )
  })

  // `invalid_origin`（Route Handler 对跨站 POST 的 403）**本轮刻意不覆盖**：给它加键等于新增
  // 一句抽取前不存在的用户可见英文，而阶段 1 的验收线建立在「输出与改造前等价」上。这条断言
  // 把「今天走通用兜底串」这个事实钉住，阶段 2 给它专门文案时它会（也应当）变红——变更可见，
  // 不是被绕过。移交项见 `.superpowers/sdd/2026-10-13-i18n-phase1-locale-routing/task-8-report.md`。
  it('invalid_origin 今天仍走通用兜底串（阶段 2 补专门文案）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: 'invalid_origin' }) }),
    )
    await expect(commerceRequest('cart', parseCartView)).rejects.toThrowError(
      new Error(messages('en')['errors.unknown']),
    )
  })
})
