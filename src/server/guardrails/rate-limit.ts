import { createBoundedStore, validGuardrailKey } from './bounded-store'

export const MAX_RATE_BUCKETS = 10_000

export interface Bucket {
  tokens: number
  ts: number
}
export function tokenBucket(
  ratePerMin: number,
  burst = ratePerMin,
  options: { now?: () => number; maxEntries?: number } = {},
) {
  if (
    !Number.isFinite(ratePerMin) ||
    ratePerMin <= 0 ||
    !Number.isSafeInteger(burst) ||
    burst < 1
  ) {
    throw new Error('Token bucket requires a positive rate and integer burst')
  }
  const nowMs = options.now ?? Date.now
  const perMs = ratePerMin / 60_000
  const buckets = createBoundedStore<Bucket>({
    // Expiry must never grant tokens before the bucket would have fully refilled.
    ttlMs: Math.max(60_000, Math.ceil(burst / perMs)),
    maxEntries: options.maxEntries ?? MAX_RATE_BUCKETS,
    now: nowMs,
  })
  return {
    allow(key: string, now = nowMs()): boolean {
      if (!validGuardrailKey(key)) return false
      const b = buckets.get(key, now) ?? { tokens: burst, ts: now }
      const at = Math.max(now, b.ts)
      b.tokens = Math.min(burst, b.tokens + (at - b.ts) * perMs)
      b.ts = at
      const ok = b.tokens >= 1
      if (ok) b.tokens -= 1
      return buckets.set(key, b, at) && ok
    },
    size: buckets.size,
    dispose: buckets.dispose,
  }
}
