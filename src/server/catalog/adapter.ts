import type { CatalogAdapter } from './types'
import { seedAdapter } from './seed-adapter'
import { shopifyStub, shopifyEnabled } from './shopify-stub'
export const catalog: CatalogAdapter = shopifyEnabled() ? shopifyStub : seedAdapter
