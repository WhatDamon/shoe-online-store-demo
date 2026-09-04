import { listProductsForMarket } from '@/server/catalog/service'
import { ProductGrid } from '@/components/shop/product-grid'

const FEATURED_COUNT = 4

export async function FeaturedGrid() {
  const products = await listProductsForMarket({ sort: 'featured' })

  return (
    <section aria-labelledby="featured-heading" className="bg-canvas">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">The lineup</p>
        <h2
          id="featured-heading"
          className="mt-3 font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
        >
          Fresh prints, ready in your size
        </h2>
        <div className="mt-10">
          <ProductGrid products={products.slice(0, FEATURED_COUNT)} />
        </div>
      </div>
    </section>
  )
}
