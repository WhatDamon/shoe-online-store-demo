import { describe, expect, it } from 'vitest'
import { giftItems } from './gifts'

describe('gift data (decision #16)', () => {
  it('has the merged unique gift set with stable shape', () => {
    expect(giftItems.length).toBe(9)
    const handles = giftItems.map((g) => g.handle)
    expect(new Set(handles).size).toBe(handles.length)
    handles.forEach((h) => expect(h).toMatch(/^[a-z0-9-]+$/))
  })
  it('every gift has images, colors and an English title', () => {
    for (const g of giftItems) {
      expect(g.images.length).toBeGreaterThan(0)
      g.images.forEach((src) => expect(src).toMatch(/^\/products\/[a-z0-9-]+\/\d+\.webp$/))
      expect(g.colors.length).toBeGreaterThan(0)
      expect(g.title.length).toBeGreaterThan(0)
      expect(g.titleCn.length).toBeGreaterThan(0)
    }
  })
})
