// Shopify Buy Button 通道（决策 #15 重启用；#19 曾整体回退，2026-09-06 按 29 款真目录重建）。
// 职责仅限「购买通道」映射：本站 Product.handle（= 供应商货号小写，如 dc-1001 / 26016-m）
// → Shopify 商店同 handle 商品的 numeric id（Buy Button 的 createComponent 需要）。
//
// 低耦合边界（吸取 #19 回退教训）：
//  - 不写 Product 类型、不进 products 表、不改 schema —— 映射是独立静态表；
//  - 激活走独立 env 键 SHOPIFY_BUY_*，绝不复用 SHOPIFY_DOMAIN / SHOPIFY_STOREFRONT_TOKEN
//    （那两个是 catalog 适配器的开关，一旦同配会把运行时目录源切成抛错的 shopifyStub）。
//
// 数据来源：商店 03zrk0-2u.myshopify.com 现有 29 款商品（2026-09-06 Storefront API 快照，
// 与本站 supplier.json 29 款 handle 一一对应，title 均为 "<英文名> - <货号>"）。
// 其中 24 款 id 出现在用户提供的 shopify_buy_button.txt（admin 生成的 Buy Button 代码，26 个
// 挂载块含 2 个重复商品），其余 5 款（dc-26075 / 26027-m / 26019-m / 26017-m / 26016-m）经同一
// Storefront API 拉取补齐。维护：商店增删改商品时，用 Storefront GraphQL products 查询刷新下表。

export interface ShopifyBuyConfig {
  productId: string
  domain: string
  storefrontAccessToken: string
  /** Buy SDK 的价格格式（当前商店货币 ¥，来源 snippet moneyFormat 解码） */
  moneyFormat: string
}

// SAFETY: 表键即本站 seed handle（supplier.json handle，import.py 以 slugify(code) 生成），
// 与商店 handle 同名 —— 除 JX119-X 一项：商店为历史遗留 handle '联盟新创-jx119-x'
// （title 仍为 '联盟新创 JX119-X'，货号可辨），此处以本站 handle 'jx119-x' 为键。
export const SHOPIFY_PRODUCT_IDS: Readonly<Record<string, string>> = {
  '26006-f': '9407854805207', // Citrus Step - 26006-F
  '26010-m': '9407856083159', // Alpine Split - 26010-M
  '26011-m': '9407855788247', // Orange Blaze - 26011-M
  '26012-m': '9407855624407', // Ivory Court - 26012-M
  '26013-m': '9407855919319', // Silver Haze - 26013-M
  '26014-m': '9407855886551', // Moss Runner - 26014-M
  '26015-m': '9407854837975', // Monochrome Ace - 26015-M
  '26016-m': '9407856148695', // Avocado Kick - 26016-M
  '26017-m': '9407856115927', // Cocoa Glide - 26017-M
  '26018-m': '9407856017623', // Yolk Runner - 26018-M
  '26019-m': '9407856050391', // Blush Day - 26019-M
  '26027-m': '9407855755479', // Lime Sprint - 26027-M
  '26037-m': '9407856181463', // Party Bright - 26037-M
  'dc-1001': '9407853625559', // Urban Bloom - DC-1001
  'dc-1002': '9407854280919', // Fresh Field - DC-1002
  'dc-1003': '9407854477527', // Mint Canvas - DC-1003
  'dc-1004': '9407855231191', // Flash Green - DC-1004
  'dc-1005': '9407855427799', // Midnight Walk - DC-1005
  'dc-1006': '9407855591639', // Cocoa Low - DC-1006
  'dc-1007': '9407854674135', // Blush Slip - DC-1007
  'dc-1008': '9407854772439', // Court Glow - DC-1008
  'dc-1009': '9407854641367', // Neon Pulse - DC-1009
  'dc-1010': '9407854706903', // Blush Low - DC-1010
  'dc-1011': '9407856214231', // Night Flight - DC-1011
  'dc-1012': '9407856246999', // Parade Pop - DC-1012
  'dc-1013': '9407856279767', // Cloud Mint - DC-1013
  'dc-26075': '9407854870743', // Triple Tone - DC-26075
  jx119: '9407855001815', // Silver Swoop - JX119
  'jx119-x': '9406447583447', // Noir Stealth - JX119-X（店 handle 遗留 联盟新创-jx119-x）
}

/** 本地 handle → 商店 numeric id；无对应商品（商店未上架）→ null。 */
export function shopifyProductIdFor(handle: string): string | null {
  return SHOPIFY_PRODUCT_IDS[handle] ?? null
}

// 激活开关：与 catalog 适配器完全隔离的独立键。buildClient 的 domain/token 会被打进
// 客户端 bundle（Buy Button SDK 本就是浏览器端脚本，token 为公开 Storefront 只读令牌）。
// 未配置 → PDP 维持 demo 购买条（P1 克制：零购买 UI，不静默半激活）。
const envDomain = () => process.env.SHOPIFY_BUY_DOMAIN?.trim() || ''
const envToken = () => process.env.SHOPIFY_BUY_TOKEN?.trim() || ''
const envMoney = () => process.env.SHOPIFY_BUY_MONEY_FORMAT || '¥{{amount}}'

/**
 * handle 的商店购买配置；未启用（env 缺 domain/token）或商品无映射 → null。
 * env 在调用时读取（不在模块顶层），便于测试与运行时热配。
 */
export function shopifyBuyConfigFor(handle: string): ShopifyBuyConfig | null {
  const productId = shopifyProductIdFor(handle)
  const domain = envDomain()
  const token = envToken()
  if (!productId || !domain || !token) return null
  return { productId, domain, storefrontAccessToken: token, moneyFormat: envMoney() }
}
