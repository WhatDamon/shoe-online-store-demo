export interface CommerceVariant {
  id: string
  color: string
  size: number
  price: string
  currency: string
  available: number
}
export interface CommerceProduct {
  variants: CommerceVariant[]
}
export interface CartLine {
  id: string
  variant_id: string
  title: string
  sku: string
  color: string
  size: number
  quantity: number
  unit_price: string
  available?: number
  sellable?: boolean
}
/** Fulfilment axis. Money is never encoded here; see `payment_status`. */
export type OrderStatus = 'pending_payment' | 'paid' | 'cancelled' | 'refunded'

/** Funds axis, orthogonal to `OrderStatus`: an order can be `paid` while refunding. */
export type PaymentStatus =
  'disabled' | 'requires_payment' | 'succeeded' | 'refund_pending' | 'refunded'

/** Machine-readable outcome of `POST payments/session`. Only `payment_ready` means "go pay". */
export type PaymentCode =
  'payment_disabled' | 'payment_ready' | 'order_not_payable' | 'currency_unsupported'

export type PaymentProvider = 'mock' | 'stripe'

export interface CartView {
  items: CartLine[]
  total: string
  currency: string
}
export interface OrderView extends CartView {
  id: string
  status: OrderStatus
  expires_at: string | null
  cancellation_reason: 'expired' | 'customer_cancelled' | null
  payment_enabled: boolean
  /** `null` until the order has a payment row; `disabled` means the provider never charged. */
  payment_status: PaymentStatus | null
  message: string
}
export interface PaymentSessionView {
  code: PaymentCode
  payment_enabled: boolean
  provider: PaymentProvider
  order_id: string
  order_status: OrderStatus
  /** Non-null **only** when `code === 'payment_ready'`; navigate here to pay. */
  redirect_url: string | null
  message: string
}
