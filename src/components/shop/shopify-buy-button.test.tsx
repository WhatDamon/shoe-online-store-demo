import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShopifyBuyButton } from './shopify-buy-button'

const config = {
  handle: '3d-shoes',
  domain: '03zrk0-2u.myshopify.com',
  productId: 8_123_456_789,
  token: 'public-storefront-token',
}

interface FakeUi {
  createComponent: ReturnType<typeof vi.fn>
}
interface FakeSdk {
  buildClient: ReturnType<typeof vi.fn>
  UI: { onReady: ReturnType<typeof vi.fn> }
}

function makeSdk(ui?: FakeUi): FakeSdk {
  const resolvedUi: FakeUi = ui ?? { createComponent: vi.fn(async () => {}) }
  return {
    buildClient: vi.fn(() => ({})),
    UI: { onReady: vi.fn(async () => resolvedUi) },
  }
}

describe('ShopifyBuyButton', () => {
  const previous = (window as unknown as { ShopifyBuy?: unknown }).ShopifyBuy

  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { ShopifyBuy?: unknown }).ShopifyBuy
  })

  afterEach(() => {
    ;(window as unknown as { ShopifyBuy?: unknown }).ShopifyBuy = previous
  })

  it('mounts the product component through the SDK with node + site skin', async () => {
    const ui = { createComponent: vi.fn(async () => {}) }
    ;(window as unknown as { ShopifyBuy?: unknown }).ShopifyBuy = makeSdk(ui)

    const { container } = render(<ShopifyBuyButton config={config} />)

    await waitFor(() => expect(ui.createComponent).toHaveBeenCalledTimes(1))
    const calls = ui.createComponent.mock.calls as unknown as Array<
      [kind: string, config: Record<string, unknown>]
    >
    const [, cfg] = calls[0]
    expect(cfg.id).toBe(config.productId)
    // 显式挂到 mount 节点（而非隐式 body），options 注入站点皮肤
    expect(container.querySelector('[data-testid="shopify-buy-button"]')).not.toBeNull()
    expect(cfg.node).toBeInstanceOf(HTMLElement)
    const options = cfg.options as Record<string, unknown>
    const product = options.product as Record<string, unknown>
    const styles = product.styles as Record<string, unknown>
    const button = styles.button as Record<string, unknown>
    const contents = product.contents as Record<string, unknown>
    const cartText = (options.cart as Record<string, unknown>).text as Record<string, unknown>
    expect(button['background-color']).toBe('#111111')
    expect(button['border-radius']).toBe('10px')
    // 重复内容（媒体/标题/描述）被裁剪：内嵌只留 variant/数量/价格/加购
    expect(contents.img).toBe(false)
    expect(contents.title).toBe(false)
    expect(contents.description).toBe(false)
    // 购物车抽屉结账已启用
    expect(cartText.button).toBe('Checkout')
  })

  it('degrades to a store product link when the SDK fails', async () => {
    const sdk = makeSdk()
    sdk.UI.onReady = vi.fn(async () => {
      throw new Error('network down')
    })
    ;(window as unknown as { ShopifyBuy?: unknown }).ShopifyBuy = sdk

    render(<ShopifyBuyButton config={config} />)

    const link = await screen.findByText('Buy on Shopify', {}, { timeout: 2000 })
    expect(link.getAttribute('href')).toBe('https://03zrk0-2u.myshopify.com/products/3d-shoes')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})
