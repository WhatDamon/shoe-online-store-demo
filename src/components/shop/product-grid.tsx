import type { ProductView } from '@/server/catalog/service'
import { ProductCard } from './product-card'

export function ProductGrid({ products }: { products: ProductView[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <li key={product.handle}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  )
}
