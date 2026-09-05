import type { Product } from './types'
import supplier from './data/supplier.json'

// 供应商真实目录（决策 #16）：源为 /Users/damon233/Downloads/萨洛丁款式集合.xlsx，
// 经 scripts/import-catalog/import.py 抽取（图片 WebP → public/products/<handle>/，清单 → data/supplier.json）。
// 本文件 = 策展层：营销名/集合/价格/文案为演示占位（图片、色系、码段、货号为真实数据），
// 可随时按 code 覆写。尺码为 EU 整档并集（女 35-40# + 男 39-44# → 35-44），直读不换算。
// 目录顺序即 featured 默认序（seed-adapter 按 id 排序 → 以序号前缀保证稳定）。

export interface SupplierShoe {
  handle: string
  code: string
  genders: 'women' | 'men' | 'both' | 'none'
  sizes_eu: number[]
  segments: { kind: 'women' | 'men'; lo: number; hi: number }[]
  colors: { en: string; hex: string; cn: string }[]
  images: string[]
}

// SAFETY: supplier.json 由 scripts/import-catalog/import.py 生成（结构固定：shoes/gifts/_meta），
// TS 对 JSON 的推断是宽泛字面量类型，转成受检接口；运行时字段缺失会在 toProduct 抛错兜底。
const shoes = (supplier as unknown as { shoes: SupplierShoe[] }).shoes

// 策展表：code → { 营销名, 集合, 可选价格覆写 }。集合为站点策展桶（非供应商分类）。
// 价格为演示占位（$98-178 价带内轮转，决策 #16）。
interface Curation {
  title: string
  collections: string[]
  price?: number
}
const CURATION: Record<string, Curation> = {
  'DC-1001': { title: 'Urban Bloom', collections: ['everyday'] },
  'DC-1002': { title: 'Fresh Field', collections: ['everyday'] },
  'DC-1003': { title: 'Mint Canvas', collections: ['everyday'] },
  'DC-1009': { title: 'Neon Pulse', collections: ['everyday'] },
  'DC-1007': { title: 'Blush Slip', collections: ['comfort'] }, // 暂无尺码
  'DC-1010': { title: 'Blush Low', collections: ['comfort'] },
  'DC-1008': { title: 'Court Glow', collections: ['travel'] },
  '26006-F': { title: 'Citrus Step', collections: ['travel'] },
  '26015-M': { title: 'Monochrome Ace', collections: ['minimal'] },
  'DC-26075': { title: 'Triple Tone', collections: ['minimal'] },
  'JX119-X': { title: 'Noir Stealth', collections: ['minimal'] },
  JX119: { title: 'Silver Swoop', collections: ['minimal'] },
  'DC-1004': { title: 'Flash Green', collections: ['travel'] },
  'DC-1005': { title: 'Midnight Walk', collections: ['comfort'] },
  'DC-1006': { title: 'Cocoa Low', collections: ['comfort'] },
  '26012-M': { title: 'Ivory Court', collections: ['minimal'] },
  '26027-M': { title: 'Lime Sprint', collections: ['travel'] },
  '26011-M': { title: 'Orange Blaze', collections: ['travel'] },
  '26014-M': { title: 'Moss Runner', collections: ['travel'] },
  '26013-M': { title: 'Silver Haze', collections: ['minimal'] },
  '26018-M': { title: 'Yolk Runner', collections: ['travel'] },
  '26019-M': { title: 'Blush Day', collections: ['everyday'] },
  '26010-M': { title: 'Alpine Split', collections: ['comfort'] },
  '26017-M': { title: 'Cocoa Glide', collections: ['comfort'] },
  '26016-M': { title: 'Avocado Kick', collections: ['everyday'] },
  '26037-M': { title: 'Party Bright', collections: ['everyday'] },
  'DC-1011': { title: 'Night Flight', collections: ['minimal'] },
  'DC-1012': { title: 'Parade Pop', collections: ['travel'] },
  'DC-1013': { title: 'Cloud Mint', collections: ['travel'] },
}

const DEMO_PRICES = [108, 128, 148, 118, 138, 98, 158, 168, 178]

const GENDER_WORD: Record<SupplierShoe['genders'], string> = {
  women: "Women's",
  men: "Men's",
  both: 'Unisex',
  none: '',
}

const colorNames = (s: SupplierShoe) => s.colors.map((c) => c.en)
const sizeRunText = (s: SupplierShoe) =>
  s.segments
    .map((seg) => `${seg.kind === 'women' ? "Women's" : "Men's"} ${seg.lo}–${seg.hi}`)
    .join(', ')

const hex = (value: string) => (value || '').toLowerCase()

function toProduct(s: SupplierShoe, index: number): Product {
  const cur = CURATION[s.code]
  if (!cur) throw new Error(`missing curation for ${s.code}`)
  const names = colorNames(s)
  const hasSizes = s.sizes_eu.length > 0
  const genderWord = GENDER_WORD[s.genders]
  const descParts = [
    `A ${genderWord ? `${genderWord.toLowerCase()} ` : ''}everyday sneaker offered in ${s.colors.length} colorway${s.colors.length === 1 ? '' : 's'}: ${names.join(', ')}.`,
    hasSizes ? `Available in ${sizeRunText(s)}.` : 'Size range to be confirmed by the studio.',
  ]
  const subtitleParts = [genderWord, `${names.length} colorways`].filter(Boolean)
  return {
    id: `evo-${String(index + 1).padStart(2, '0')}`,
    handle: s.handle,
    title: cur.title,
    subtitle: subtitleParts.join(' · '),
    description: descParts.join(' '),
    price: { amount: cur.price ?? DEMO_PRICES[index % DEMO_PRICES.length], currencyCode: 'USD' },
    productType: 'Sneaker',
    tags: ['casual', 'real-catalog'],
    collections: cur.collections,
    sizes: s.sizes_eu,
    // 促销性文案克制：仅事实（色系/码段）；材质/结构不做虚构声明。
    features: hasSizes
      ? [`${s.colors.length} colorways`, `Size run ${sizeRunText(s)}`, 'Fits true to size']
      : ['Size range to be confirmed', 'Fits true to size'],
    fitNotes: 'Fits true to size with a medium width; if between sizes, size up.',
    construction: {
      pattern: 'lattice',
      density: 0.75,
      printedUpper: false, // 真实供应链鞋款，不做 3D 打印字段声明
    },
    visual: {
      // SVG 兜底：取自真实色系前/末两色（近似 hex，演示）
      palette: [
        hex(s.colors[0]?.hex ?? '#e7e5df'),
        hex(s.colors[s.colors.length - 1]?.hex ?? '#d6d3cd'),
      ],
      accent: hex(s.colors[0]?.hex ?? '#0f766e'),
      views: 3,
    },
    images: s.images,
    colors: s.colors.map((c) => ({ name: c.en, hex: hex(c.hex) })),
    createdAt: '2026-09-06T00:00:00Z',
  }
}

export const seedProducts: Product[] = shoes.map(toProduct)
