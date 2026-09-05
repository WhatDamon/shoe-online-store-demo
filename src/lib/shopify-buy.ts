// Shopify Buy Button 配置（spec 决策 #15）。
// 读取 process.env.SHOPIFY_BUY_BUTTON —— admin 生成的 Buy Button 嵌入码里能直接
// 取到 domain + storefront token + 商品 numeric id；本站把它存成一个 JSON env，
// PDP 仅在 handle 匹配时把购买条替换为 Buy Button 挂载位（未配置 = 零购买 UI）。
export interface ShopifyBuyButtonConfig {
  /** 本站商品 handle（PDP 展示哪个商品时启用挂载） */
  handle: string
  /** Shopify storefront 域名，如 03zrk0-2u.myshopify.com */
  domain: string
  /** Buy Button 嵌入码中的商品 numeric id */
  productId: number
  /** Buy Button 嵌入码自带的 storefront token（公开只读，设计上用于客户端） */
  token: string
  /** 嵌入码 moneyFormat（如 ¥{{amount}}，URL 编码的 ¥ 已解码）；缺省用店铺默认 */
  moneyFormat?: string
}

/** 纯函数解析（env 实参注入便于测试，避免 vi.stubEnv） */
export function parseShopifyBuyButton(raw: string | undefined): ShopifyBuyButtonConfig | null {
  if (!raw || !raw.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { handle, domain, productId, token, moneyFormat } = parsed as Record<string, unknown>
  if (
    typeof handle !== 'string' ||
    handle.length === 0 ||
    typeof domain !== 'string' ||
    domain.length === 0 ||
    typeof productId !== 'number' ||
    !Number.isFinite(productId) ||
    productId <= 0 ||
    typeof token !== 'string' ||
    token.length === 0
  ) {
    return null
  }
  // 空串按未提供处理（环境变量常被置空以禁用）；非字符串/有值非串 → 结构非法
  if (moneyFormat !== undefined && typeof moneyFormat !== 'string') {
    return null
  }
  const mf = typeof moneyFormat === 'string' && moneyFormat.length > 0 ? moneyFormat : undefined
  return { handle, domain, productId, token, ...(mf ? { moneyFormat: mf } : {}) }
}

/** 调用时读取 env：与 market.code 同一策略（懒读取）。SSG 构建期快照差异同 decision #14 备注。 */
export function shopifyBuyButtonForHandle(handle: string): ShopifyBuyButtonConfig | null {
  const cfg = parseShopifyBuyButton(process.env.SHOPIFY_BUY_BUTTON)
  return cfg?.handle === handle ? cfg : null
}
