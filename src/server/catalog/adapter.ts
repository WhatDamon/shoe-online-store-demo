import { envStr } from '@/config'
import type { CatalogAdapter } from './adapter-contract'
import { DbCatalogAdapter } from './db-adapter'
import { seedAdapter } from './seed-adapter'
import { shopifyStub, shopifyEnabled } from './shopify-stub'

// 运行时目录源：默认 DB（products 表，表空自动灌种）。优先级：
//   SHOPIFY_* 均已配置 → shopify stub（契约占位，真实现后续）
//   CATALOG_SOURCE=seed → 内存导入层（单元测试与兜底）
//   其余 → DB
const pick = (): CatalogAdapter => {
  if (shopifyEnabled()) return shopifyStub
  if (envStr('CATALOG_SOURCE') === 'seed') return seedAdapter
  return new DbCatalogAdapter()
}

let instance: CatalogAdapter | null = null

/**
 * 取运行时目录源。**首次调用**时才读 env 并缓存实例，不在 import 时快照 ——
 * 模块级快照会让测试只能靠 vitest config 级 env 绕过，也让部署改配置必须重启进程。
 * 实例必须缓存：DbCatalogAdapter 内部持有「已灌种」的 promise，每次新建会重复灌种。
 */
export const catalog = (): CatalogAdapter => (instance ??= pick())
