import { describe, expect, it } from 'vitest'
import { convert, nearestCanonical, parseSizeHint } from './size-charts'

describe('convert', () => {
  it('converts EU 42 to US 8.5 (unisex basis)', () => expect(convert(42, 'US')).toBe(8.5))
  it('converts EU 42 to UK 7.5', () => expect(convert(42, 'UK')).toBe(7.5))
  it('round-trips EU via mm anchor', () => expect(convert(convert(42, 'US'), 'EU')).toBe(42))
})
describe('nearestCanonical', () => {
  it('picks closest in-stock EU size', () => {
    expect(nearestCanonical(41.5, [40, 42, 43])).toBe(42)
    expect(nearestCanonical(40, [40, 42])).toBe(40)
  })
  it('clamps when out of range', () => expect(nearestCanonical(50, [40, 42])).toBe(42))
})
describe('parseSizeHint', () => {
  it('parses US label', () => expect(parseSizeHint('I usually wear US 9')).toBe(43)) // EU 43
  it('parses EU label', () => expect(parseSizeHint('size 42')).toBe(42))
  it('parses foot length cm', () => expect(parseSizeHint('my foot is 27 cm')).toBe(43))
  it('returns null when no size found', () => expect(parseSizeHint('comfortable')).toBeNull())
})
