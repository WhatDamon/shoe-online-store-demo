'use client'

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { loadWishlist, saveWishlist, toggleWishlist } from '@/lib/wishlist'

interface WishlistValue {
  items: string[]
  toggle: (handle: string) => void
}

const WishlistContext = createContext<WishlistValue | null>(null)

/**
 * localStorage-backed wishlist exposed as an external store.
 *
 * Why an external store instead of useState + an effect:
 * - Hydration safety: the server snapshot is a constant empty list, so the
 *   server HTML and the first hydrated render are always identical. React
 *   re-reads the client snapshot right after hydration and re-renders with the
 *   stored items — no hydration mismatch.
 * - The lint rule `react-hooks/set-state-in-effect` forbids a synchronous
 *   setState in an effect, so the naive "load in useEffect" shape is not
 *   available.
 *
 * The snapshot is read lazily and only on the client; `loadWishlist()` itself
 * already returns `[]` whenever `window` is undefined (server prerender).
 */
let snapshot: string[] = []
let loaded = false
const listeners = new Set<() => void>()

const ensureLoaded = (): string[] => {
  if (!loaded) {
    snapshot = loadWishlist()
    loaded = true
  }
  return snapshot
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): string[] => ensureLoaded()

const getServerSnapshot = (): string[] => []

export function WishlistProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const toggle = useCallback((handle: string) => {
    const next = toggleWishlist(ensureLoaded(), handle)
    snapshot = next
    saveWishlist(next)
    for (const listener of listeners) listener()
  }, [])

  const value = useMemo(() => ({ items, toggle }), [items, toggle])

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}

export function useWishlist(): WishlistValue {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error('useWishlist must be used within a WishlistProvider')
  return ctx
}
