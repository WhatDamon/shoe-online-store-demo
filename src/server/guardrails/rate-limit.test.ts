import { describe, expect, it } from 'vitest'
import { tokenBucket } from './rate-limit'

describe('tokenBucket', () => {
  it('连发超过 burst 后拒绝', () => {
    const b = tokenBucket(3, 3)
    expect(b.allow('k', 0)).toBe(true)
    expect(b.allow('k', 1)).toBe(true)
    expect(b.allow('k', 2)).toBe(true)
    expect(b.allow('k', 3)).toBe(false)
  })

  it('时间前进后令牌补充、恢复放行', () => {
    const b = tokenBucket(3, 3)
    expect(b.allow('k', 0)).toBe(true)
    expect(b.allow('k', 1)).toBe(true)
    expect(b.allow('k', 2)).toBe(true)
    expect(b.allow('k', 3)).toBe(false)
    // 60s 后补满 burst
    expect(b.allow('k', 60_000)).toBe(true)
  })

  it('不同 key 独立计桶', () => {
    const b = tokenBucket(1, 1)
    expect(b.allow('ip:a', 0)).toBe(true)
    expect(b.allow('ip:a', 1)).toBe(false)
    expect(b.allow('ip:b', 1)).toBe(true)
  })

  it('size 反映在册桶数', () => {
    const b = tokenBucket(3)
    b.allow('x')
    b.allow('y')
    expect(b.size()).toBe(2)
  })
})
