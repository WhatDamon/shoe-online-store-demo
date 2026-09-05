// 跨任务统一的领域契约（禁改名）。canonical 尺码存储：EU 整档 35–48（决策 #16 扩至 35）。
export type SizeSystem = 'US' | 'EU' | 'UK' | 'JP' | 'CN'
export type CanonicalSize = number // EU 整档，35–48（唯一 canonical 存储）
type CurrencyCode = 'USD' // 市场决策 #9：本版锁定 USD

export interface Price {
  amount: number
  currencyCode: CurrencyCode // amount 为美元数值
}

/** 可选色卡（决策 #16 供应链颜色词典）：营销名 + 近似 hex（小写）。仅用于下单前选色。 */
export interface Colorway {
  name: string
  hex: string
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
  visual: { palette: [string, string]; accent: string; views: 3 } // 驱动 SVG（无图兜底）
  /** 真实商品照片（public/products/<handle>/*.webp，决策 #16）；缺省/空 → SVG 视觉兜底。 */
  images?: string[]
  /** 可选色卡；缺省/单色 → PDP 不渲染色卡选择（照片不代表具体色）。 */
  colors?: Colorway[]
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
