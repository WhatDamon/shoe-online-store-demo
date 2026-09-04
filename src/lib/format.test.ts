import { describe, expect, it } from 'vitest'
import { formatPrice } from './format'
import type { Price } from '@/server/catalog/types'

describe('formatPrice', () => {
  it('formats dollars with two decimals', () => expect(formatPrice(139)).toBe('$139.00'))
  it('formats an amount carried by a Price contract (currencyCode USD) in USD', () => {
    const price: Price = { amount: 98, currencyCode: 'USD' }
    expect(formatPrice(price.amount)).toBe('$98.00')
  })
})
