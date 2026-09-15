import { describe, expect, it } from 'vitest'
import { parseWishlist, toggleWishlist } from './wishlist'

describe('parseWishlist', () => {
  it('未存储（null）→ []', () => {
    expect(parseWishlist(null)).toEqual([])
  })

  it('损坏内容 → [] 而不是抛错', () => {
    expect(parseWishlist('{not json')).toEqual([])
  })

  it('非数组 → []；混入的非字符串项被过滤', () => {
    expect(parseWishlist('{"a":1}')).toEqual([])
    expect(parseWishlist('["daily-drift", 42, null]')).toEqual(['daily-drift'])
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
