import type { ProductFilter } from '@/server/catalog/types'
export type ShopFilter = ProductFilter & { sizeLabels?: string[] }

/** URL 搜索参数 → 服务层可消费的筛选对象。size 为市场标签（"US 9"），由服务层换算 canonical。 */
export function parseShopParams(sp: URLSearchParams): ShopFilter {
  const size = sp.getAll('size') // 市场标签 "US 9"
  const sort = sp.get('sort') as ShopFilter['sort']
  return {
    collection: sp.get('collection') ?? undefined,
    minPrice: sp.get('minPrice') ? Number(sp.get('minPrice')) : undefined,
    maxPrice: sp.get('maxPrice') ? Number(sp.get('maxPrice')) : undefined,
    q: sp.get('q') ?? undefined,
    sizeLabels: size.length ? size : undefined,
    sort: ['featured', 'price-asc', 'price-desc', 'newest'].includes(sort as string)
      ? sort
      : 'featured',
  }
}

/** 筛选对象 → URL 查询串（不含 "?"）；未设字段与 featured 默认省略，sizeLabels 逐项重复。 */
export function serializeShopParams(f: ShopFilter): string {
  const sp = new URLSearchParams()
  if (f.collection) sp.set('collection', f.collection)
  for (const label of f.sizeLabels ?? []) sp.append('size', label)
  if (f.minPrice != null) sp.set('minPrice', String(f.minPrice))
  if (f.maxPrice != null) sp.set('maxPrice', String(f.maxPrice))
  if (f.q) sp.set('q', f.q)
  if (f.sort && f.sort !== 'featured') sp.set('sort', f.sort)
  return sp.toString()
}
