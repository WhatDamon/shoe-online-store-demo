const KEY = 'evoloop:wishlist'
const EMPTY: string[] = []
// 安全解析：localStorage 值损坏（非 JSON / 非数组 / 混入非字符串）时回退空列表，
// 避免 wishlist 读取在 Provider 挂载期抛错崩页。
export const loadWishlist = (): string[] => {
  if (typeof window === 'undefined') return EMPTY
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return EMPTY
    return parsed.filter((h): h is string => typeof h === 'string')
  } catch {
    return EMPTY
  }
}
export const saveWishlist = (items: string[]) => window.localStorage.setItem(KEY, JSON.stringify(items))
export const toggleWishlist = (items: string[], handle: string): string[] =>
  items.includes(handle) ? items.filter(h => h !== handle) : [...items, handle]
