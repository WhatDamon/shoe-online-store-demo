import { describe, expect, it } from 'vitest'
import { toggleWishlist } from './wishlist'
describe('toggleWishlist', () => {
  it('adds then removes a handle', () => {
    const once = toggleWishlist([], 'a')
    expect(once).toEqual(['a'])
    expect(toggleWishlist(once, 'a')).toEqual([])
  })
  it('keeps order of additions', () => {
    expect(toggleWishlist(['b'], 'a')).toEqual(['b', 'a'])
  })
})
