import supplier from './data/supplier.json'

// 满 $50 赠一个的小件（决策 #16）：供应商边角料制小物，仅营销展示 —— 不单独售卖、
// 不进正价目录/筛选/AI 检索。图片取自同一导入管线（public/products/<handle>/*.webp）。

export interface GiftItem {
  handle: string
  title: string
  titleCn: string // 供应链原名留档
  colors: string[] // 展示色名（EN）
  images: string[]
  description: string
}

// SAFETY: supplier.json 的 gifts 结构由 import.py 固定（handle/title/title_cn/colors/images/rows），
// TS 对 JSON 的推断为宽泛字面量，转成受检接口；字段缺失时下方 map 会显式报错。
interface GiftItemSource {
  handle: string
  title: string
  title_cn: string
  colors: { en: string; hex: string; cn: string }[]
  images: string[]
}

// SAFETY: gifts 段结构由 import.py 固定（上面接口），运行时缺失会在此显式报错。
const giftSource = (supplier as unknown as { gifts: GiftItemSource[] }).gifts

const OFFER_COPY =
  'A little buddy pressed from leftover upper offcuts. Free with any order over $50 — while supplies last.'

export const giftItems: GiftItem[] = giftSource.map((g) => ({
  handle: g.handle,
  title: g.title,
  titleCn: g.title_cn,
  colors: g.colors.map((c) => c.en),
  images: g.images,
  description: OFFER_COPY,
}))
