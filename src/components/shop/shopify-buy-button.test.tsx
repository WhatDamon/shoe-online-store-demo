import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { ShopifyBuyButton } from './shopify-buy-button'
import type { ShopifyBuyConfig } from '@/server/catalog/shopify-buy'

const config: ShopifyBuyConfig = {
  domain: 'example.myshopify.com',
  storefrontAccessToken: 'test-token',
  productId: '9407853625559',
  moneyFormat: '¥{{amount}}',
}

// 复现 dev StrictMode 双跑 effect（React 19 开发模式 mount → cleanup → mount）：
// 若组件不防重，同一 mount 节点会被 SDK createComponent 注入两套 Buy now（页面上下并排）。
function installSdk() {
  const createComponent = vi.fn().mockResolvedValue(undefined)
  const sdk = {
    buildClient: vi.fn(() => ({})),
    UI: { onReady: vi.fn(async () => ({ createComponent })) },
  }
  ;(window as unknown as { ShopifyBuy: unknown }).ShopifyBuy = sdk
  return { sdk, createComponent }
}

describe('ShopifyBuyButton strict-mode safety', () => {
  beforeEach(() => {
    document.head.querySelectorAll('script[data-bb]').forEach((s) => s.remove())
  })

  afterEach(() => {
    delete (window as unknown as { ShopifyBuy?: unknown }).ShopifyBuy
    document.head.querySelectorAll('script[data-bb]').forEach((s) => s.remove())
    vi.restoreAllMocks()
  })

  it('creates exactly one Buy component under StrictMode double-effect', async () => {
    const { sdk, createComponent } = installSdk()
    expect(sdk).toBeDefined()

    const { container } = render(
      <StrictMode>
        <ShopifyBuyButton config={config} />
      </StrictMode>,
    )

    // 让双跑 effect 的异步 init 链全部完成
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // 防重核心断言：两遍 effect / 两个 init 只允许一次 createComponent
    expect(createComponent).toHaveBeenCalledTimes(1)
    expect(createComponent).toHaveBeenCalledWith(
      'product',
      expect.objectContaining({ id: config.productId, moneyFormat: config.moneyFormat }),
    )
    // mount 节点内只应有一个 SDK 注入产物
    expect(container.querySelector('.shopify-buy')?.childElementCount).toBeLessThanOrEqual(1)
  })
})
