export interface Bucket { tokens: number; ts: number }
export function tokenBucket(ratePerMin: number, burst = ratePerMin) {
  const buckets = new Map<string, Bucket>()
  const perMs = ratePerMin / 60_000
  return {
    allow(key: string, now = Date.now()): boolean {
      const b = buckets.get(key) ?? { tokens: burst, ts: now }
      b.tokens = Math.min(burst, b.tokens + (now - b.ts) * perMs)
      b.ts = now
      const ok = b.tokens >= 1
      if (ok) b.tokens -= 1
      buckets.set(key, b)
      return ok
    },
    size: () => buckets.size,
  }
}
