export const MAX_KEY_CHARS = 128
export const CLEANUP_INTERVAL_MS = 60_000

export const validGuardrailKey = (key: string): boolean =>
  typeof key === 'string' &&
  key.length > 0 &&
  key.length <= MAX_KEY_CHARS &&
  /^[A-Za-z0-9:._-]+$/.test(key)

/** Single-process storage. Capacity rejects new keys; it never evicts live limits. */
export function createBoundedStore<T>(options: {
  ttlMs: number
  maxEntries: number
  now?: () => number
}) {
  const { ttlMs, maxEntries, now = Date.now } = options
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs <= 0 ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries <= 0
  ) {
    throw new Error('Guardrail storage requires positive TTL and capacity')
  }
  const entries = new Map<string, { value: T; expiresAt: number }>()
  const intervalMs = Math.min(ttlMs, CLEANUP_INTERVAL_MS)
  let nextSweep = now() + intervalMs
  const sweep = (at = now()) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(key)
    }
    nextSweep = at + intervalMs
  }
  // Also clean idle stores. unref prevents a timer from keeping Node alive.
  const timer = setInterval(() => sweep(), intervalMs)
  timer.unref?.()
  const read = (key: string, at: number) => {
    if (at >= nextSweep) sweep(at)
    const entry = entries.get(key)
    if (entry && entry.expiresAt <= at) {
      entries.delete(key)
      return undefined
    }
    return entry
  }
  return {
    get(key: string, at = now()): T | undefined {
      return validGuardrailKey(key) ? read(key, at)?.value : undefined
    },
    set(key: string, value: T, at = now()): boolean {
      if (!validGuardrailKey(key)) return false
      const existing = read(key, at)
      if (!existing && entries.size >= maxEntries) return false
      entries.set(key, { value, expiresAt: at + ttlMs })
      return true
    },
    size: () => entries.size,
    dispose() {
      clearInterval(timer)
      entries.clear()
    },
  }
}
