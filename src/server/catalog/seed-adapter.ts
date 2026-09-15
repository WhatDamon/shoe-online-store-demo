import { seedProducts } from './seed'
import { collections } from './collections'
import { filterProducts } from './filter'
import type { Product, ProductFilter } from '@/domain/product'
import type { CatalogAdapter } from './adapter-contract'

// 纯内存目录源（导入层兜底/测试）：CATALOG_SOURCE=seed 时使用。
export class SeedAdapter implements CatalogAdapter {
  async getProducts(filter: ProductFilter = {}): Promise<Product[]> {
    return filterProducts(seedProducts, filter)
  }
  async getProductByHandle(handle: string): Promise<Product | null> {
    return seedProducts.find((p) => p.handle === handle) ?? null
  }
  async getCollections() {
    return collections
  }
  // 无 store → null（占位 + 适配器就绪）；_product 仅为符合 CatalogAdapter 契约（Shopify 实现在用）。
  async getBuyUrl(_product?: Product): Promise<null> {
    void _product
    return null
  }
}
export const seedAdapter = new SeedAdapter()
