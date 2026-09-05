import type { Repository } from '@/server/search/repository'
import { createDefaultRepository } from '@/server/search/repository'
import { productFromRecord, productToRecord } from '@/db/product-row'
import { collections } from './collections'
import { filterProducts } from './filter'
import { seedProducts } from './seed'
import type { CatalogAdapter, Collection, Product, ProductFilter } from './types'

// DB 运行时目录适配器（决策 #17）：products 表空时自动从导入层（seed 策展）灌种一次；
// 此后读取一律走表。注入 repoFactory 便于测试用 :memory:；构造不做任何 DB 访问（懒）。
export class DbCatalogAdapter implements CatalogAdapter {
  private repoInstance: Repository | null = null
  private seeded: Promise<void> | null = null

  constructor(private readonly repoFactory: () => Repository = createDefaultRepository) {}

  private repo(): Repository {
    this.repoInstance ??= this.repoFactory()
    return this.repoInstance
  }

  private ensureSeeded(): Promise<void> {
    this.seeded ??= this.hydrate()
    return this.seeded
  }

  private async hydrate(): Promise<void> {
    const repo = this.repo()
    if ((await repo.countProducts()) > 0) return
    await repo.upsertProducts(seedProducts.map(productToRecord))
  }

  async getProducts(filter: ProductFilter = {}): Promise<Product[]> {
    await this.ensureSeeded()
    const rows = await this.repo().listAllProducts()
    return filterProducts(rows.map(productFromRecord), filter)
  }

  async getProductByHandle(handle: string): Promise<Product | null> {
    await this.ensureSeeded()
    const rows = await this.repo().listAllProducts()
    return rows.map(productFromRecord).find((p) => p.handle === handle) ?? null
  }

  async getCollections(): Promise<Collection[]> {
    return collections
  }

  // 无 store → null（与 seed 阶段同一契约；真 Shopify 接入后由对应实现替换）。
  async getBuyUrl(_product?: Product): Promise<null> {
    void _product
    return null
  }
}
