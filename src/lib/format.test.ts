import { describe, expect, it } from 'vitest'
import { formatPrice } from './format'

describe('formatPrice', () => {
  it('formats dollars with two decimals', () => expect(formatPrice(139)).toBe('$139.00'))
})
