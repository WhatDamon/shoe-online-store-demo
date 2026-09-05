import { describe, expect, it } from 'vitest'
import { sizeRangeLabel } from './size-range'

const opts = (pairs: [number, string][]) => pairs.map(([value, label]) => ({ value, label }))

describe('sizeRangeLabel', () => {
  it('returns null for an empty option list', () => {
    expect(sizeRangeLabel([])).toBeNull()
  })

  it('single option shows only that label', () => {
    expect(sizeRangeLabel(opts([[44, 'US 10.5']]))).toBe('US 10.5')
  })

  it('same-market range keeps the system prefix once: US 10–10.5 (integer → half of one band)', () => {
    expect(
      sizeRangeLabel(
        opts([
          [43, 'US 10'],
          [44, 'US 10.5'],
        ]),
      ),
    ).toBe('US 10–10.5')
  })

  it('same-market range across bands: US 9.5–11', () => {
    expect(
      sizeRangeLabel(
        opts([
          [42, 'US 9.5'],
          [43, 'US 10'],
          [44, 'US 10.5'],
          [45, 'US 11'],
        ]),
      ),
    ).toBe('US 9.5–11')
  })

  it('EU range renders EU 43–45', () => {
    expect(
      sizeRangeLabel(
        opts([
          [43, 'EU 43'],
          [44, 'EU 44'],
          [45, 'EU 45'],
        ]),
      ),
    ).toBe('EU 43–45')
  })

  it('unsorted input is normalized by canonical value', () => {
    expect(
      sizeRangeLabel(
        opts([
          [45, 'US 11'],
          [43, 'US 10'],
        ]),
      ),
    ).toBe('US 10–11')
  })

  it('cross-system or unparseable labels degrade to the full pair', () => {
    expect(
      sizeRangeLabel(
        opts([
          [43, 'US 10'],
          [45, 'EU 45'],
        ]),
      ),
    ).toBe('US 10–EU 45')
    expect(
      sizeRangeLabel(
        opts([
          [43, 'US 10'],
          [45, 'US 11 (wide)'],
        ]),
      ),
    ).toBe('US 10–US 11 (wide)')
  })
})
