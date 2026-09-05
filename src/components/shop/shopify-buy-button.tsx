'use client'

import { useEffect, useRef } from 'react'
import type { ShopifyBuyButtonConfig } from '@/lib/shopify-buy'

// 极简 SDK 类型（Buy Button storefront SDK 无官方类型）：client 是只在
// buildClient → UI.onReady 间传递的不透明句柄，方法参数都在 I/O 边界解码。
interface ShopifyClient {
  /** 不透明标记：SDK 内部对象，调用方不解引用。 */
  readonly __shopifyClient?: true
}
interface ShopifyUi {
  createComponent(
    kind: 'product',
    config: {
      id: string | number
      node?: HTMLElement
      moneyFormat?: string
      options?: Record<string, unknown>
    },
  ): void | Promise<void>
}
interface ShopifyBuySdk {
  buildClient(config: { domain: string; storefrontAccessToken: string }): ShopifyClient
  UI: { onReady(client: ShopifyClient): Promise<ShopifyUi> }
}

declare global {
  interface Window {
    ShopifyBuy?: ShopifyBuySdk
  }
}

// 官方 Buy Button SDK（v3，与 admin 生成的嵌入码一致）：
// https://shopify.dev/docs/storefronts/headless/additional-sdks/buy-button
const OFFICIAL_SDK_URL =
  'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js'
function loadSdk(): Promise<ShopifyBuySdk> {
  return new Promise((resolve, reject) => {
    if (window.ShopifyBuy) {
      resolve(window.ShopifyBuy)
      return
    }
    // 脚本 async 加载，window.ShopifyBuy 就绪后 resolve
    const script = document.createElement('script')
    script.src = OFFICIAL_SDK_URL
    script.async = true
    script.onload = () =>
      window.ShopifyBuy
        ? resolve(window.ShopifyBuy)
        : reject(new Error('SDK loaded without ShopifyBuy'))
    script.onerror = () => reject(new Error('Failed to load Shopify Buy Button SDK'))
    document.head.appendChild(script)
  })
}

// ---- 站点皮肤（决策 #15 深定制）：从 globals.css 设计令牌镜像而来 ----
const INK = '#111111' // --ink（浅色态 primary 近似值 oklch(0.205 0 0)）
const PRICE_INK = '#111111'
const MUTED = '#525252'
const RADIUS = '10px' // rounded-lg == --radius-lg == 0.625rem
// body 字体（Geist 自托管 + 回退），Buy Button 挂载于页面 DOM，可继承站点字体
const BODY_FONT =
  "var(--font-geist-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)"

function buildOptions(): Record<string, unknown> {
  const solid = {
    'background-color': INK,
    ':hover': { 'background-color': INK },
    ':focus': { 'background-color': INK },
    'border-radius': RADIUS,
    'font-family': BODY_FONT,
    'font-weight': 500,
  }
  return {
    // PDP 上方已有本站相册/标题/描述（决策：Buy 模块全接管交互区），
    // 内嵌只保留真实 variant 选择 + 数量 + 价格 + 加购，避免视觉重复。
    product: {
      layout: 'vertical',
      width: '100%',
      styles: {
        product: { 'text-align': 'left', 'max-width': '100%', 'margin-left': '0' },
        title: { display: 'none', 'font-family': BODY_FONT },
        description: { display: 'none' },
        price: {
          'font-family': BODY_FONT,
          'font-size': '20px',
          'font-weight': 600,
          color: PRICE_INK,
        },
        compareAt: { 'font-family': BODY_FONT, 'font-size': '14px', color: MUTED },
        unitPrice: { 'font-family': BODY_FONT, 'font-size': '12px', color: MUTED },
        variant: { 'font-family': BODY_FONT, color: PRICE_INK },
        quantity: { 'font-family': BODY_FONT },
        button: { ...solid, 'font-size': '16px' },
      },
      contents: {
        title: false,
        description: false,
        img: false,
        imgWithCarousel: false,
      },
      text: { button: 'Add to cart' },
    },
    cart: {
      styles: {
        button: { ...solid },
        title: { 'font-family': BODY_FONT },
      },
      text: { total: 'Subtotal', button: 'Checkout' },
    },
    toggle: { styles: { toggle: { ...solid } } },
  }
}

// scoped 校准层：inline style 覆盖不到的 Buy Button 结构类（标题/描述/卡片容器）。
// 只作用于本挂载位内部（.evoloop-buy 祖先），不动全站其它 Buy DOM；纯静态 CSS 常量，无用户输入。
const SKIN_CSS = `
.evoloop-buy { font-family: ${BODY_FONT}; }
.evoloop-buy .shopify-buy__product,
.evoloop-buy .shopify-buy__product__media,
.evoloop-buy .shopify-buy__product__title,
.evoloop-buy .shopify-buy__product__description { display: none !important; }
.evoloop-buy .shopify-buy__product,
.evoloop-buy .shopify-buy__layout { box-shadow: none !important; }
.evoloop-buy .shopify-buy__btn { width: 100% !important; padding-top: 12px !important; padding-bottom: 12px !important; }
`

interface ShopifyBuyButtonProps {
  config: ShopifyBuyButtonConfig
}

// PDP 购买模块（spec 决策 #15 深定制版）：SDK 挂到显式 node，
// options 全量接管交互（真实 variant/数量/价格/加购），外带购物车抽屉结账。
// SDK 不可用或加载失败 → 优雅回退为店铺商品页直链（锚点方式导航，无 open-redirect 面）。
// 全程 DOM API / React 文本节点（无 innerHTML）。
export function ShopifyBuyButton({ config }: ShopifyBuyButtonProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let cancelled = false

    async function init(): Promise<void> {
      try {
        const sdk = await loadSdk()
        if (cancelled || !root) return
        const client = sdk.buildClient({
          domain: config.domain,
          storefrontAccessToken: config.token,
        })
        const ui = await sdk.UI.onReady(client)
        if (cancelled || !root) return
        await ui.createComponent('product', {
          id: config.productId,
          node: root,
          moneyFormat: config.moneyFormat,
          options: buildOptions(),
        })
      } catch {
        if (cancelled || !root) return
        // 优雅降级：店铺商品页直链
        const fallback = document.createElement('a')
        fallback.href = `https://${config.domain}/products/${config.handle}`
        fallback.rel = 'noopener'
        fallback.textContent = 'Buy on Shopify'
        root.replaceChildren(fallback)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [config])

  return (
    <>
      {/* 静态皮肤校准（常量 CSS，无注入面） */}
      <style>{SKIN_CSS}</style>
      <div
        ref={rootRef}
        data-testid="shopify-buy-button"
        aria-label={`Buy ${config.handle} on Shopify`}
        className="evoloop-buy min-h-12"
      />
    </>
  )
}
