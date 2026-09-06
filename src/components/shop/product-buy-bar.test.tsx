import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductBuyBar } from './product-buy-bar'

describe('ProductBuyBar demo checkout (2026-09: no store → Buy now → payment QR)', () => {
  it('shows an enabled Buy now button and no Shopify small print', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel={null} />)

    const button = screen.getByRole('button', { name: 'Buy now' })
    expect(button).toBeEnabled()
    // Shopify 相关小字已删除（用户决策）
    expect(screen.queryByText('Checkout lands on our Shopify store.')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the demo checkout QR dialog on Buy now and closes it again', async () => {
    const user = userEvent.setup()
    render(
      <ProductBuyBar
        buyUrl={null}
        availableSoon
        selectedLabel={null}
        productTitle="Urban Bloom"
        priceLabel="$69.00"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Buy now' }))
    const dialog = screen.getByRole('dialog', { name: 'Demo checkout' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Urban Bloom')
    expect(dialog).toHaveTextContent('$69.00')
    expect(screen.getByRole('img', { name: 'Payment QR code (demo)' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/scan to complete this demo order/i)

    await user.click(screen.getByRole('button', { name: 'Close demo checkout' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('links to the store when a buy URL is configured (dormant adapter path)', () => {
    render(
      <ProductBuyBar
        buyUrl="https://example.shopify.com/products/daily-drift"
        availableSoon={false}
        selectedLabel={null}
      />,
    )

    const link = screen.getByRole('link', { name: 'Add to bag' })
    expect(link).toHaveAttribute('href', 'https://example.shopify.com/products/daily-drift')
  })
})

describe('ProductBuyBar selection announcement', () => {
  it('announces the picked size alone', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel="US 9" />)
    expect(screen.getByRole('status')).toHaveTextContent('US 9 selected')
  })

  it('announces size and color together', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel="US 9" colorName="Ivory" />)
    expect(screen.getByRole('status')).toHaveTextContent('US 9 · Ivory selected')
  })

  it('announces only the picked color when no size is picked', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel={null} colorName="Ivory" />)
    expect(screen.getByRole('status')).toHaveTextContent('Ivory selected')
  })
})
