'use client'

import { useEffect, useRef } from 'react'
import type { ShopifyBuyButtonConfig } from '@/lib/shopify-buy'

// 极简 SDK 类型（Buy Button storefront SDK 无官方类型）。
interface ShopifyBuySdk {
  buildClient(config: { domain: string; storefrontAccessToken: string }): unknown
  UI: {
    onReady(
      client: unknown,
    ): Promise<{ createComponent(kind: string, config: unknown): void | Promise<void> }>
  }
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

interface ShopifyBuyButtonProps {
  config: ShopifyBuyButtonConfig
}

// PDP 购买条位置的 Shopify Buy Button 挂载位（spec 决策 #15）。
// 仅当 env 配置匹配当前商品 handle 时由页面渲染；SDK 全程 DOM API（无 innerHTML）。
// SDK 不可用时优雅回退为店铺商品页直链（锚点方式导航，同源无 open-redirect 面）。
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
        await ui.createComponent('product', { id: config.productId })
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
    <div
      ref={rootRef}
      data-testid="shopify-buy-button"
      aria-label={`Buy ${config.handle} on Shopify`}
      className="min-h-12"
    />
  )
}
