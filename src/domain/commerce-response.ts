import type {
  CartLine,
  CartView,
  CommerceProduct,
  OrderStatus,
  OrderView,
  PaymentCode,
  PaymentSessionView,
  PaymentStatus,
  PaymentProvider,
} from './commerce'

const ORDER_STATUSES = ['pending_payment', 'paid', 'cancelled', 'refunded'] as const
const PAYMENT_STATUSES = [
  'disabled',
  'requires_payment',
  'succeeded',
  'refund_pending',
  'refunded',
] as const
const PAYMENT_CODES = [
  'payment_disabled',
  'payment_ready',
  'order_not_payable',
  'currency_unsupported',
] as const
const PAYMENT_PROVIDERS = ['mock', 'stripe'] as const

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : invalid()
}

function invalid(): never {
  throw new Error('Invalid commerce response')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalid()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid()
}

function money(value: unknown): string {
  const result = text(value)
  return result === result.trim() && /^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(result) ? result : invalid()
}

function currency(value: unknown): string {
  const result = text(value)
  return result === result.trim() && /^[A-Z]{3}$/.test(result) ? result : invalid()
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : invalid()
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid()
}

export function parseCommerceProduct(value: unknown): CommerceProduct {
  const data = record(value)
  return {
    variants: list(data.variants, (entry) => {
      const variant = record(entry)
      return {
        id: text(variant.id),
        color: text(variant.color),
        size: integer(variant.size, 1),
        price: money(variant.price),
        currency: currency(variant.currency),
        available: integer(variant.available, 0),
      }
    }),
  }
}

function parseLine(value: unknown): CartLine {
  const line = record(value)
  if (line.sellable !== undefined && typeof line.sellable !== 'boolean') invalid()
  return {
    id: text(line.id),
    variant_id: text(line.variant_id),
    title: text(line.title),
    sku: text(line.sku),
    color: text(line.color),
    size: integer(line.size, 1),
    quantity: integer(line.quantity, 1, 99),
    unit_price: money(line.unit_price),
    ...(line.available === undefined ? {} : { available: integer(line.available, 0) }),
    ...(line.sellable === undefined ? {} : { sellable: line.sellable as boolean }),
  }
}

export function parseCartView(value: unknown): CartView {
  const data = record(value)
  return {
    items: list(data.items, parseLine),
    total: money(data.total),
    currency: currency(data.currency),
  }
}

export function parseOrderView(value: unknown): OrderView {
  const data = record(value)
  const status: OrderStatus = oneOf(data.status, ORDER_STATUSES)
  const enabled = data.payment_enabled
  if (typeof enabled !== 'boolean') invalid()
  const funds = data.payment_status
  const paymentStatus: PaymentStatus | null = funds === null ? null : oneOf(funds, PAYMENT_STATUSES)
  const reason = data.cancellation_reason
  if (reason !== null && reason !== 'expired' && reason !== 'customer_cancelled') invalid()
  const expires = data.expires_at === null ? null : text(data.expires_at)
  if (
    expires !== null &&
    (expires !== expires.trim() ||
      !/T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(expires) ||
      !Number.isFinite(Date.parse(expires)))
  )
    invalid()
  return {
    ...parseCartView(data),
    id: text(data.id),
    status,
    expires_at: expires,
    cancellation_reason: reason,
    payment_enabled: enabled,
    payment_status: paymentStatus,
    message: text(data.message),
  }
}

/**
 * `redirect_url` is the only value the client navigates to, so it must be an https URL and it
 * must be present **only** when the backend actually opened a payable session. A missing key is
 * treated as `null` so a serializer that omits nulls cannot be mistaken for "clear to pay".
 */
export function parsePaymentSessionView(value: unknown): PaymentSessionView {
  const data = record(value)
  const code: PaymentCode = oneOf(data.code, PAYMENT_CODES)
  const enabled = data.payment_enabled
  if (typeof enabled !== 'boolean') invalid()
  const provider: PaymentProvider = oneOf(data.provider, PAYMENT_PROVIDERS)
  const orderStatus: OrderStatus = oneOf(data.order_status, ORDER_STATUSES)
  const raw = data.redirect_url
  const redirect = raw === undefined || raw === null ? null : text(raw)
  if (code === 'payment_ready') {
    if (redirect === null || !/^https:\/\/[^\s]+$/.test(redirect)) invalid()
  } else if (redirect !== null) invalid()
  return {
    code,
    payment_enabled: enabled,
    provider,
    order_id: text(data.order_id),
    order_status: orderStatus,
    redirect_url: redirect,
    message: text(data.message),
  }
}
