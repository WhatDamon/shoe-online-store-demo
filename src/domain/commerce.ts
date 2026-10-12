import type { components } from './commerce-api.generated'

// API shapes come from Python. These projections retain the existing page contract.
type Schemas = components['schemas']
export type CommerceVariant = Pick<
  Schemas['VariantResponse'],
  'id' | 'color' | 'size' | 'price' | 'currency' | 'available'
>
export type CommerceProduct = {
  [Key in keyof Pick<Schemas['ProductResponse'], 'variants'>]: CommerceVariant[]
}
// Old cart responses omit inventory fields; order items never include them.
export type CartLine = Schemas['OrderItemResponse'] &
  Partial<Pick<Schemas['CartItemResponse'], 'available' | 'sellable'>>
export type CartView = Omit<Schemas['CartResponse'], 'items'> & { items: CartLine[] }
export type OrderView = Omit<Schemas['OrderResponse'], 'items'> & { items: CartLine[] }
export type PaymentView = Schemas['PaymentResponse']
