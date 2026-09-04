const KEY = 'treadwell:wishlist'
export const loadWishlist = (): string[] => JSON.parse(typeof window === 'undefined' ? '[]' : (window.localStorage.getItem(KEY) ?? '[]'))
export const saveWishlist = (items: string[]) => window.localStorage.setItem(KEY, JSON.stringify(items))
export const toggleWishlist = (items: string[], handle: string): string[] =>
  items.includes(handle) ? items.filter(h => h !== handle) : [...items, handle]
