'use client'

import { useEffect, useId, useRef, useState } from 'react'
import buyOptions from './shopify-buy-options.json'
import type { ShopifyBuyConfig } from '@/server/catalog/shopify-buy'

// Shopify Buy Button 统一挂载组件（决策 #15 重启用，2026-09-06 全目录重建）。
// 读取 admin 生成的 snippet（shopify_buy_button.txt，28 块 options 逐字一致）的参数化结论：
// 26 个挂载块的唯一差别是商品 numeric id，其余（domain/token/moneyFormat/options）每块相同 →
// 本组件只按 productId 参数化，加载官方 SDK 后 createComponent('product', …)。
//
// 克制 P1 / 诚实降级：sdk 加载失败不弹错，仅静默留空容器（页面其余 PDP 内容不受影响），
// 控制台 console.warn 一条便于诊断；组件不渲染任何 "Powered by"/AI 类文案。
interface ShopifyBuySdk {
  buildClient(config: { domain: string; storefrontAccessToken: string }): unknown
  UI: {
    onReady(client: unknown): Promise<{ createComponent(kind: 'product', opts: unknown): unknown }>
  }
}

declare global {
  interface Window {
    ShopifyBuy?: ShopifyBuySdk
  }
}

const SDK_URL = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js'

export function ShopifyBuyButton({ config }: { config: ShopifyBuyConfig }) {
  const mountId = useId()
  const mountRef = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)

  // SDK 注入采用 Promise 化 script 加载（async，无阻塞）。
  // react-hooks/set-state-in-effect 禁 render/effect 体直接 setState：
  // 所有 setStarted 只发生在 async 回调（load 完成 / init 后）与按钮 onClick（重试）。
  useEffect(() => {
    let cancelled = false
    const node = mountRef.current
    if (!node) return

    const init = async () => {
      const sdk = window.ShopifyBuy
      if (!sdk || !sdk.UI) return
      try {
        const client = sdk.buildClient({
          domain: config.domain,
          storefrontAccessToken: config.storefrontAccessToken,
        })
        const ui = await sdk.UI.onReady(client)
        ui.createComponent('product', {
          id: config.productId,
          node,
          moneyFormat: config.moneyFormat,
          options: buyOptions,
        })
        if (!cancelled) setStarted(true)
      } catch (err) {
        // 诚实失败：console 诊断，界面保持空容器（不假渲染成功）。
        console.warn('Shopify Buy Button init failed:', err)
      }
    }

    if (window.ShopifyBuy) {
      void init()
      return
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => void init(), { once: true })
      return
    }
    const script = document.createElement('script')
    script.async = true
    script.src = SDK_URL
    script.addEventListener('load', () => void init(), { once: true })
    document.head.appendChild(script)

    return () => {
      cancelled = true
    }
  }, [config.productId, config.domain, config.storefrontAccessToken, config.moneyFormat])

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={mountRef}
        id={`shopify-buy-${mountId}`}
        className="shopify-buy"
        data-product-id={config.productId}
      />
      {!started ? (
        <button
          type="button"
          disabled
          className="w-full rounded-full bg-ink py-2.5 text-base text-canvas opacity-60"
        >
          Buy now
        </button>
      ) : null}
    </div>
  )
}
