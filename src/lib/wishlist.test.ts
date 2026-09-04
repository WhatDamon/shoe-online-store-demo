import { describe, expect, it, beforeEach } from 'vitest'
import { loadWishlist, toggleWishlist } from './wishlist'
const KEY = 'evoloop:wishlist'

describe('loadWishlist', () => {
  beforeEach(() => window.localStorage.clear())
  it('returns [] when nothing is stored', () => {
    expect(loadWishlist()).toEqual([])
  })
  it('returns [] instead of throwing when the stored value is corrupt', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(loadWishlist()).toEqual([])
  })
  it('returns [] for a non-array value and filters non-string entries', () => {
    window.localStorage.setItem(KEY, '{"a":1}')
    expect(loadWishlist()).toEqual([])
    window.localStorage.setItem(KEY, '["daily-drift", 42, null]')
    expect(loadWishlist()).toEqual(['daily-drift'])
  })
})

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
