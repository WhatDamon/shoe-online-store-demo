import { catalog } from '@/server/catalog/adapter'
import { availableSizesForSystem } from '@/server/catalog/size-charts'
import { listProductsForMarket } from '@/server/catalog/service'
import { market } from '@/lib/market'
import { parseShopParams } from '@/lib/shop-search-params'
import { ProductFilterBar } from '@/components/shop/product-filter-bar'
import { ProductGrid } from '@/components/shop/product-grid'
import { EmptyState } from './empty-state'
import { pageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata = pageMetadata({
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
          <ProductGrid products={products} />
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState />
        </div>
      )}
    </div>
  )
}
