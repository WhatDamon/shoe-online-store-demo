import type { CatalogAdapter } from './types'
import { DbCatalogAdapter } from './db-adapter'
import { seedAdapter } from './seed-adapter'
import { shopifyStub, shopifyEnabled } from './shopify-stub'

// 运行时目录源（决策 #17）：默认 DB（products 表，表空自动灌种）。优先级：
//   SHOPIFY_* 均已配置 → shopify stub（契约占位，真实现后续）
//   CATALOG_SOURCE=seed → 内存导入层（单元测试与兜底）
//   其余 → DB
export const catalog: CatalogAdapter = (() => {
  if (shopifyEnabled()) return shopifyStub
  if (process.env.CATALOG_SOURCE === 'seed') return seedAdapter
  return new DbCatalogAdapter()
})()
