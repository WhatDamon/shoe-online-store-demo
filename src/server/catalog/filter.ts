import type { Product, ProductFilter } from './types'

// 内存过滤/排序（29 行规模，决策 #17）：DB 负责持久化，这里统一筛选语义供 seed/db 适配器复用。
const byText = (p: Product, q: string) =>
  [p.title, p.subtitle, p.productType, ...p.tags, ...p.features, p.description]
    .join(' ')
    .toLowerCase()
    .includes(q)

export function filterProducts(list: Product[], filter: ProductFilter = {}): Product[] {
  let out = list.filter((p) => {
    if (filter.collection && !p.collections.includes(filter.collection)) return false
    if (filter.sizes?.length && !filter.sizes.some((s) => p.sizes.includes(s))) return false
    if (filter.minPrice != null && p.price.amount < filter.minPrice) return false
    if (filter.maxPrice != null && p.price.amount > filter.maxPrice) return false
    if (filter.q && !byText(p, filter.q.trim().toLowerCase())) return false
    return true
  })
  const sort = filter.sort ?? 'featured'
  out = [...out].sort((a, b) => {
    if (sort === 'price-asc') return a.price.amount - b.price.amount
    if (sort === 'price-desc') return b.price.amount - a.price.amount
    if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt)
    return a.id.localeCompare(b.id) // featured = seed/目录顺序
  })
  return out
}
