// catalog 适配器契约：三种实现（DB / 内存 seed / Shopify）全在服务端，故不进 domain。
// 领域类型（Product / ProductFilter / Collection）在 @/domain/product。
import type { Collection, Product, ProductFilter } from '@/domain/product'

export interface CatalogAdapter {
  getProducts(filter?: ProductFilter): Promise<Product[]>
  getProductByHandle(handle: string): Promise<Product | null>
  getCollections(): Promise<Collection[]>
  getBuyUrl(product: Product): Promise<string | null>
}
