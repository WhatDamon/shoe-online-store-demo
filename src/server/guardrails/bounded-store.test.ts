// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLEANUP_INTERVAL_MS, createBoundedStore, MAX_KEY_CHARS } from './bounded-store'
import { tokenBucket } from './rate-limit'
import {
  createSessionStore,
  HISTORY_TURNS,
  maxTurns,
  MAX_HISTORY_MESSAGE_CHARS,
  SESSION_TTL_MS,
} from './session-state'

const resources: { dispose(): void }[] = []
const track = <T extends { dispose(): void }>(store: T): T => {
  resources.push(store)
  return store
}
afterEach(() => {
  resources.splice(0).forEach((store) => store.dispose())
  vi.useRealTimers()
})
const clock = () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
}

describe('bounded guardrail state', () => {
  it('physically removes idle expired records without another request', () => {
    clock()
    const store = track(createBoundedStore({ ttlMs: 60_000, maxEntries: 2 }))
    expect(store.set('a', 1)).toBe(true)
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS)
    expect(store.size()).toBe(0)
    expect(store.get('a')).toBeUndefined()
  })

  it('cleans on access if timer execution was delayed, without evicting live keys', () => {
    clock()
    const store = track(createBoundedStore({ ttlMs: 60_000, maxEntries: 1 }))
    store.set('expired', 1)
    vi.setSystemTime(60_000)
    expect(store.set('replacement', 2)).toBe(true)
    expect(store.set('blocked', 3)).toBe(false)
    expect(store.get('replacement')).toBe(2)
    expect(store.size()).toBe(1)
  })

  it.each(['', 'bad key', 'bad/key', 'bad\nkey', '雪', 'x'.repeat(MAX_KEY_CHARS + 1)])(
    'rejects invalid keys without allocating (%s)',
    (key) => {
      const sessions = track(createSessionStore())
      const buckets = track(tokenBucket(1))
      expect(sessions.claim(key).allowed).toBe(false)
      sessions.push(key, 'user', 'ignored')
      expect(buckets.allow(key)).toBe(false)
      expect(sessions.size()).toBe(0)
      expect(buckets.size()).toBe(0)
    },
  )

  it('accepts UUID/IP-safe keys and the exact length bound', () => {
    const store = track(createBoundedStore({ ttlMs: 60_000, maxEntries: 5 }))
    for (const key of ['192.0.2.1', '::ffff:192.0.2.1', 'abc_123-xyz', 'x'.repeat(MAX_KEY_CHARS)]) {
      expect(store.set(key, true)).toBe(true)
    }
  })

  it('bounds a flood of unique keys and preserves exhausted live limits', () => {
    clock()
    const sessions = track(createSessionStore(Date.now, { maxEntries: 2 }))
    const buckets = track(tokenBucket(1, 1, { maxEntries: 2 }))
    for (let i = 0; i < maxTurns(); i++) expect(sessions.claim('active').allowed).toBe(true)
    expect(buckets.allow('active')).toBe(true)
    sessions.claim('second')
    buckets.allow('second')
    for (let i = 0; i < 20_000; i++) {
      expect(sessions.claim(`new-${i}`).allowed).toBe(false)
      expect(buckets.allow(`new-${i}`)).toBe(false)
    }
    expect(sessions.size()).toBe(2)
    expect(buckets.size()).toBe(2)
    expect(sessions.claim('active').allowed).toBe(false)
    expect(buckets.allow('active')).toBe(false)
  })

  it('releases both kinds of capacity on idle expiry', () => {
    clock()
    const sessions = track(createSessionStore(Date.now, { maxEntries: 1 }))
    const buckets = track(tokenBucket(1, 1, { maxEntries: 1 }))
    sessions.claim('old')
    buckets.allow('old')
    vi.advanceTimersByTime(SESSION_TTL_MS)
    expect(sessions.size()).toBe(0)
    expect(buckets.size()).toBe(0)
    expect(sessions.claim('new').allowed).toBe(true)
    expect(buckets.allow('new')).toBe(true)
  })

  it('does not expire a slow bucket before its full refill period', () => {
    clock()
    const buckets = track(tokenBucket(1, 2))
    expect(buckets.allow('k')).toBe(true)
    expect(buckets.allow('k')).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(buckets.allow('k')).toBe(true)
    expect(buckets.allow('k')).toBe(false)
  })

  it('does not mint extra tokens when the clock moves backwards', () => {
    const buckets = track(tokenBucket(1, 1, { now: () => 0 }))
    expect(buckets.allow('k', 60_000)).toBe(true)
    expect(buckets.allow('k', 0)).toBe(false)
    expect(buckets.allow('k', 60_000)).toBe(false)
    expect(buckets.allow('k', 120_000)).toBe(true)
  })

  it('caps stored message length/count and returns detached history', () => {
    clock()
    const sessions = track(createSessionStore())
    sessions.claim('s')
    for (let i = 0; i < 1_000; i++) {
      sessions.push('s', 'assistant', String(i).padEnd(MAX_HISTORY_MESSAGE_CHARS + 100, 'x'))
    }
    const { history } = sessions.claim('s')
    expect(history).toHaveLength(HISTORY_TURNS * 2)
    expect(history.every((message) => message.content.length === MAX_HISTORY_MESSAGE_CHARS)).toBe(
      true,
    )
    expect(history[0].content).toMatch(/^988/)
    history[0].content = 'tampered'
    history.push({ role: 'user', content: 'tampered' })
    expect(sessions.claim('s').history).toHaveLength(HISTORY_TURNS * 2)
    expect(sessions.claim('s').history[0].content).toMatch(/^988/)
  })

  it('drops late writes rather than resurrecting expired sessions', () => {
    clock()
    const sessions = track(createSessionStore())
    sessions.claim('s')
    vi.setSystemTime(SESSION_TTL_MS)
    sessions.push('s', 'assistant', 'late reply')
    expect(sessions.size()).toBe(0)
    expect(sessions.claim('s').history).toEqual([])
  })

  it('disposes timers and state explicitly', () => {
    clock()
    const store = track(createBoundedStore({ ttlMs: 60_000, maxEntries: 1 }))
    store.set('a', true)
    expect(vi.getTimerCount()).toBe(1)
    store.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(store.size()).toBe(0)
  })
})
