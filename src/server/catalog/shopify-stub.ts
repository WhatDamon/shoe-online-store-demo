import type { CatalogAdapter } from './types'
export const shopifyEnabled = () =>
  Boolean(process.env.SHOPIFY_DOMAIN && process.env.SHOPIFY_STOREFRONT_TOKEN)
// 本期不实现调用；shopifyEnabled()===false 时由 adapter factory 使用 SeedAdapter
export const shopifyStub: CatalogAdapter = {
  async getProducts() {
    throw new Error('Shopify adapter not configured (SHOPIFY_DOMAIN/SHOPIFY_STOREFRONT_TOKEN)')
  },
  async getProductByHandle() {
    throw new Error('Shopify adapter not configured')
  },
  async getCollections() {
    throw new Error('Shopify adapter not configured')
  },
  async getBuyUrl() {
    return null
  },
}
