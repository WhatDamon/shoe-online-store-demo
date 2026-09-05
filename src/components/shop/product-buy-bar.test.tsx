import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProductBuyBar } from './product-buy-bar'

describe('ProductBuyBar', () => {
  it('shows a disabled Available soon button when there is no store URL', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel={null} />)

    const button = screen.getByRole('button', { name: 'Available soon' })
    expect(button).toBeDisabled()
    expect(screen.getByText('Checkout lands on our Shopify store.')).toBeInTheDocument()
  })

  it('links to the store when a buy URL is configured', () => {
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

  it('announces that a picked size is still unavailable while the store is closed', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel="US 9" />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('US 9')
  })
})

describe('ProductBuyBar color + size announcement', () => {
  it('announces size and color together while the store is closed', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel="US 9" colorName="Ivory" />)
    expect(screen.getByRole('status')).toHaveTextContent('US 9 · Ivory selected')
  })

  it('announces only the picked color when no size is picked', () => {
    render(<ProductBuyBar buyUrl={null} availableSoon selectedLabel={null} colorName="Ivory" />)
    expect(screen.getByRole('status')).toHaveTextContent('Ivory selected — we open checkout')
  })
})
