import { listProductsForMarket } from '@/server/catalog/service'
import { ProductGrid } from '@/components/shop/product-grid'

export default async function ShopPage() {
  const products = await listProductsForMarket({})

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-neutral-900">Shop</h1>
      <ProductGrid products={products} />
    </main>
  )
}
