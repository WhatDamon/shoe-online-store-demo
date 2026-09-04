// 跨任务统一的领域契约（禁改名）。canonical 尺码存储：EU 整档 36–48。
export type SizeSystem = 'US' | 'EU' | 'UK' | 'JP' | 'CN'
export type CanonicalSize = number // EU 整档，36–48（唯一 canonical 存储）
export type CurrencyCode = 'USD' // 市场决策 #9：本版锁定 USD

export interface Price {
  amount: number
  currencyCode: CurrencyCode // amount 为美元数值
}

export interface Product {
  id: string
  handle: string
  title: string
  subtitle: string
  description: string
  price: Price
  productType: string
  tags: string[]
  collections: string[] // collection.handle 数组
  sizes: CanonicalSize[] // canonical EU，可用档
  features: string[] // 3D 打印卖点（格纹结构等，种子文案）
  fitNotes: string
  construction: {
    pattern: 'lattice' | 'wave' | 'honeycomb'
    density: 0.6 | 0.75 | 0.9
    printedUpper: boolean
  }
  visual: { palette: [string, string]; accent: string; views: 3 } // 驱动 SVG
  image?: { remote?: string } // 未来真实素材/Shopify 图（本期仅 localGenerated）
  createdAt: string // ISO，用于 newest 排序
}

export interface Collection {
  handle: string
  name: string
  description: string
}

export interface ProductFilter {
  collection?: string
  sizes?: CanonicalSize[]
  minPrice?: number
  maxPrice?: number
  sort?: 'featured' | 'price-asc' | 'price-desc' | 'newest'
  q?: string
}

export interface CatalogAdapter {
  getProducts(filter?: ProductFilter): Promise<Product[]>
  getProductByHandle(handle: string): Promise<Product | null>
  getCollections(): Promise<Collection[]>
  getBuyUrl(product: Product): Promise<string | null>
}
