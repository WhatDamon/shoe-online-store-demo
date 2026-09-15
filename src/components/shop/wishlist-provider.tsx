'use client'

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPersistentStore } from '@/lib/create-store'
import { parseWishlist, toggleWishlist, WISHLIST_KEY } from '@/lib/wishlist'

interface WishlistValue {
  items: string[]
  toggle: (handle: string) => void
}

const WishlistContext = createContext<WishlistValue | null>(null)

// 引用稳定的 SSR 常量快照（React 19 缓存契约，理由见 create-store.ts）。
const EMPTY_ITEMS: string[] = []

const wishlist = createPersistentStore<string[]>({
  key: WISHLIST_KEY,
  serverSnapshot: EMPTY_ITEMS,
  decode: parseWishlist,
  encode: (items) => JSON.stringify(items),
})

export function WishlistProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(
    wishlist.subscribe,
    wishlist.getSnapshot,
    wishlist.getServerSnapshot,
  )

  const toggle = useCallback((handle: string) => {
    wishlist.set((prev) => toggleWishlist(prev, handle))
  }, [])

  const value = useMemo(() => ({ items, toggle }), [items, toggle])

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}

export function useWishlist(): WishlistValue {
  const ctx = useContext(WishlistContext)
  if (!ctx) throw new Error('useWishlist must be used within a WishlistProvider')
  return ctx
}

// 非抛出版本：允许在 Provider 未必存在的场景（如商品卡单元测试、Provider 尚未挂载的
// SSR 首帧）安全探测——返回 null 时调用方应隐藏收藏控件，而不是崩溃。
export function useOptionalWishlist(): WishlistValue | null {
  return useContext(WishlistContext)
}
