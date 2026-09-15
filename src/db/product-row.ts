import type { Colorway, Product } from '@/domain/product'

// products 表的「规范列 + JSON 副列」编解码（决策 #17）。
// 表结构两方言同构：核心字段成列，list/对象字段以 JSON 文本落副列。
// 读写全走这里单点映射；行数据损坏时显式抛错（DB 已是运行时源，不允许静默降级）。

export interface ProductRecord {
  id: string
  handle: string
  title: string
  subtitle: string
  description: string
  priceAmount: number
  currency: string
  productType: string
  collections: string // JSON string[]
  sizes: string // JSON number[]（canonical EU）
  colors: string // JSON Colorway[]
  features: string // JSON string[]
  tags: string // JSON string[]
  construction: string // JSON {pattern,density,printedUpper}
  visual: string // JSON {palette,accent,views}
  images: string // JSON string[]
  fitNotes: string
  createdAt: string
}

const encode = JSON.stringify

function decode<T>(raw: string, column: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`products.${column} row is corrupt JSON`)
  }
}

export function productToRecord(p: Product): ProductRecord {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    subtitle: p.subtitle,
    description: p.description,
    priceAmount: p.price.amount,
    currency: p.price.currencyCode,
    productType: p.productType,
    collections: encode(p.collections),
    sizes: encode(p.sizes),
    colors: encode(p.colors ?? []),
    features: encode(p.features),
    tags: encode(p.tags),
    construction: encode(p.construction),
    visual: encode(p.visual),
    images: encode(p.images ?? []),
    fitNotes: p.fitNotes,
    createdAt: p.createdAt,
  }
}

export function productFromRecord(r: ProductRecord): Product {
  return {
    id: r.id,
    handle: r.handle,
    title: r.title,
    subtitle: r.subtitle,
    description: r.description,
    price: { amount: r.priceAmount, currencyCode: r.currency as 'USD' },
    productType: r.productType,
    collections: decode<string[]>(r.collections, 'collections'),
    sizes: decode<number[]>(r.sizes, 'sizes'),
    colors: decode<Colorway[]>(r.colors, 'colors'),
    features: decode<string[]>(r.features, 'features'),
    tags: decode<string[]>(r.tags, 'tags'),
    construction: decode<Product['construction']>(r.construction, 'construction'),
    visual: decode<Product['visual']>(r.visual, 'visual'),
    images: decode<string[]>(r.images, 'images'),
    fitNotes: r.fitNotes,
    createdAt: r.createdAt,
  }
}

/**
 * products 表行形状与 ProductRecord 一一对应（两方言同构，见 schema.ts / schema-postgres.ts），
 * 所以 select() 的行可直接当记录用、insert 可直接吃记录，唯一需要变形的是 upsert 的 set：
 * id 是冲突目标（主键），冲突时不应变更。整个 DB 层只在这里摘主键。
 */
export function withoutId(r: ProductRecord): Omit<ProductRecord, 'id'> {
  const { id, ...rest } = r
  return rest
}
