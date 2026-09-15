export const WISHLIST_KEY = 'evoloop:wishlist'

/**
 * localStorage 原始值 → 句柄列表。
 * 安全解析：值损坏（非 JSON / 非数组 / 混入非字符串）时回退空列表，
 * 避免 wishlist 读取在 Provider 挂载期抛错崩页。
 *
 * 只做解析，不碰 localStorage —— 读写由 wishlist-provider 的 store 负责。
 */
export const parseWishlist = (raw: string | null): string[] => {
  if (raw == null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((h): h is string => typeof h === 'string')
  } catch {
    return []
  }
}

export const toggleWishlist = (items: string[], handle: string): string[] =>
  items.includes(handle) ? items.filter((h) => h !== handle) : [...items, handle]
