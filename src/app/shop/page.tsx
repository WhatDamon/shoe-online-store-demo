import { catalog } from '@/server/catalog/adapter'
import type { Metadata } from 'next'
import { availableSizesForSystem } from '@/server/catalog/size-charts'
import { listProductsForMarket } from '@/server/catalog/service'
import { giftItems } from '@/server/catalog/gifts'
import { market } from '@/lib/market'
import { parseShopParams } from '@/lib/shop-search-params'
import { ProductFilterBar } from '@/components/shop/product-filter-bar'
import { ProductGrid } from '@/components/shop/product-grid'
import { GiftGallery } from '@/components/shop/gift-gallery'
import { EmptyState } from './empty-state'
import { pageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Shop',
  description: 'Shop all styles — every pair is printed to order around your size.',
})

type ShopSearchParams = { [key: string]: string | string[] | undefined }

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<ShopSearchParams>
}) {
  const raw = (await searchParams) ?? {}
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, v))
    else sp.append(key, value)
  }
  const filter = parseShopParams(sp)

  const [products, allCollections] = await Promise.all([
    listProductsForMarket(filter),
    catalog.getCollections(),
  ])
  const collectionOptions = allCollections.map((c) => ({
    value: c.handle,
    label: c.name,
  }))
  const sizeOptions = availableSizesForSystem(market.sizeSystem)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Shop</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every pair is printed to order around your size — no warehouses, no waste.
        </p>
      </header>

      {/* 赠品活动条（决策 #16）：满 $50 赠一；软文案呈现 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-surface px-4 py-3">
        <p className="text-sm text-neutral-700">
          <span className="font-medium text-ink">Spend $50, get a free gift.</span>{' '}
          <span className="text-neutral-500">
            {giftItems.length} little buddies to choose from, made from leftover upper offcuts.
          </span>
        </p>
        <a
          href="#free-gifts"
          className="text-sm font-medium text-brand underline-offset-4 transition-colors hover:underline"
        >
          See the gifts
        </a>
      </div>

      <ProductFilterBar
        initial={filter}
        collectionOptions={collectionOptions}
        sizeOptions={sizeOptions}
      />

      <p role="status" className="mt-6 text-sm text-neutral-500">
        {products.length === 1 ? '1 style' : `${products.length} styles`}
      </p>

      {products.length > 0 ? (
        <div className="mt-4">
          {/* 结果区分区标题（读屏）：商品卡 h3 需要一个 h2 祖先，避免 h1 → h3 跳级。 */}
          <h2 className="sr-only">All styles</h2>
          <ProductGrid products={products} />
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState />
        </div>
      )}

      <GiftGallery gifts={giftItems} />
    </div>
  )
}
