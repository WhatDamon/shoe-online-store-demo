// 目录来源选择（2026-10-13 切片 A）：商店兼容通道下线后，运行时来源只剩
// 「CATALOG_SOURCE=seed」（测试/兜底）与默认 DB 两种。
//
// catalog() 首次调用即缓存实例，所以改变来源选择必须先 resetModules 再动态导入；
// vitest.config.mts 全局设了 CATALOG_SOURCE=seed，因此每个用例都要显式声明期望的来源。
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('catalog source selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('ignores stale store credentials and never selects a throwing adapter', async () => {
    // 审查重点 1：存量 SHOPIFY_* 配置必须被完全忽略，不得让目录变成抛错适配器。
    vi.stubEnv('CATALOG_SOURCE', 'db')
    vi.stubEnv('SHOPIFY_ENABLED', 'true')
    vi.stubEnv('SHOPIFY_DOMAIN', 'demo.myshopify.com')
    vi.stubEnv('SHOPIFY_STOREFRONT_TOKEN', 'tok')
    vi.resetModules()

    const { catalog } = await import('./adapter')

    expect(catalog().constructor.name).toBe('DbCatalogAdapter')
  })

  it('falls back to the db adapter for a stale CATALOG_SOURCE value', async () => {
    // 审查重点 2：历史配置 CATALOG_SOURCE=shopify 必须静默回落，不抛错也不给空目录。
    vi.stubEnv('CATALOG_SOURCE', 'shopify')
    vi.resetModules()

    const { catalog } = await import('./adapter')

    expect(catalog().constructor.name).toBe('DbCatalogAdapter')
  })

  it('selects the seed adapter for CATALOG_SOURCE=seed', async () => {
    vi.stubEnv('CATALOG_SOURCE', 'seed')
    vi.resetModules()

    const { catalog } = await import('./adapter')
    const { seedAdapter } = await import('./seed-adapter')

    expect(catalog()).toBe(seedAdapter)
  })
})
