import { seedProducts } from './seed'
import { collections } from './collections'
import type { CatalogAdapter, Product, ProductFilter } from './types'

const byText = (p: Product, q: string) =>
  [p.title, p.subtitle, p.productType, ...p.tags, ...p.features, p.description].join(' ').toLowerCase().includes(q)

export class SeedAdapter implements CatalogAdapter {
  async getProducts(filter: ProductFilter = {}): Promise<Product[]> {
    let out = seedProducts.filter(p => {
      if (filter.collection && !p.collections.includes(filter.collection)) return false
      if (filter.sizes?.length && !filter.sizes.some(s => p.sizes.includes(s))) return false
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
      return a.id.localeCompare(b.id) // featured = seed 顺序
    })
    return out
  }
  async getProductByHandle(handle: string): Promise<Product | null> {
    return seedProducts.find(p => p.handle === handle) ?? null
  }
  async getCollections() { return collections }
  // 无 store → null（占位 + 适配器就绪）；_product 仅为符合 CatalogAdapter 契约（Shopify 实现在用）。
  async getBuyUrl(_product?: Product): Promise<null> {
    void _product
    return null
  }
}
export const seedAdapter = new SeedAdapter()
