import { catalog } from './adapter'
import { convert, toEU } from './size-charts'
import { market } from '@/lib/market'
import type { CanonicalSize, Product, ProductFilter, SizeSystem } from './types'

export type ProductView = Product & { sizeOptions: { value: CanonicalSize; label: string }[] }
export type MarketFilter = ProductFilter & { sizeLabels?: string[] }

const sizeLabel = (eu: CanonicalSize, system = market.sizeSystem) =>
  `${system} ${convert(eu, system)}`

function toView(p: Product): ProductView {
  return { ...p, sizeOptions: p.sizes.map(value => ({ value, label: sizeLabel(value) })) }
}

function toCanonicalSizes(sizeLabels: string[]): CanonicalSize[] {
  // "US 9" / "EU 42" 标签 → canonical EU；无法解析的标签忽略
  return sizeLabels.flatMap(l => {
    const m = l.match(/^([A-Za-z]{2})\s+([\d.]+)$/)
    if (!m) return []
    const system = m[1].toUpperCase() as SizeSystem
    const eu = system === 'EU' ? Number(m[2]) : toEU(Number(m[2]), system)
    return eu != null ? [eu as CanonicalSize] : []
  })
}

export async function listProductsForMarket(filter: MarketFilter = {}): Promise<ProductView[]> {
  const { sizeLabels, ...rest } = filter
  const canonical: ProductFilter = { ...rest }
  if (sizeLabels?.length) canonical.sizes = toCanonicalSizes(sizeLabels)
  const products = await catalog.getProducts(canonical)
  return products.map(toView)
}

export async function getProductForMarket(handle: string): Promise<ProductView | null> {
  const p = await catalog.getProductByHandle(handle)
  return p ? toView(p) : null
}
