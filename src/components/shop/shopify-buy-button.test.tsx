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

  it('mounts the product component through the SDK when available', async () => {
    const ui = { createComponent: vi.fn(async () => {}) }
    ;(window as unknown as { ShopifyBuy?: unknown }).ShopifyBuy = makeSdk(ui)

    render(<ShopifyBuyButton config={config} />)

    await waitFor(() => expect(ui.createComponent).toHaveBeenCalledTimes(1))
    expect(ui.createComponent).toHaveBeenCalledWith('product', { id: config.productId })
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
