import type { Repository } from '@/server/search/repository'
import { createDefaultRepository } from '@/server/search/repository'
import { productFromRecord, productToRecord } from '@/db/product-row'
import { collections } from './collections'
import { filterProducts } from './filter'
import { seedProducts } from './seed'
import type { CatalogAdapter, Collection, Product, ProductFilter } from './types'

// DB 运行时目录适配器（决策 #17）：products 表空时从导入层（seed 策展）灌种；
// 此后读取一律走表。增量同步：每次首读补入缺失的 seed id（例如新增店款 evo-30），
// 已有行永不被 seed 覆盖（DB 编辑优先）——因此从表里删除一个 seed id 不是受支持操作。
// 注入 repoFactory 便于测试用 :memory:；构造不做任何 DB 访问（懒）。
export class DbCatalogAdapter implements CatalogAdapter {
  private repoInstance: Repository | null = null
  private synced: Promise<void> | null = null

  constructor(private readonly repoFactory: () => Repository = createDefaultRepository) {}

  private repo(): Repository {
    this.repoInstance ??= this.repoFactory()
    return this.repoInstance
  }

  private ensureSynced(): Promise<void> {
    this.synced ??= this.syncSeed()
    return this.synced
  }

  private async syncSeed(): Promise<void> {
    const repo = this.repo()
    const existing = await repo.listAllProducts()
    const present = new Set(existing.map((r) => r.id))
    const missing = seedProducts.filter((p) => !present.has(p.id))
    if (missing.length > 0) {
      await repo.upsertProducts(missing.map(productToRecord))
    }
  }

  async getProducts(filter: ProductFilter = {}): Promise<Product[]> {
    await this.ensureSynced()
    const rows = await this.repo().listAllProducts()
    return filterProducts(rows.map(productFromRecord), filter)
  }

  async getProductByHandle(handle: string): Promise<Product | null> {
    await this.ensureSynced()
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
