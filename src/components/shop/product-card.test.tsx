import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProductCard } from './product-card'
import type { ProductView } from '@/server/catalog/service'

const p: ProductView = {
  id: 'p01', handle: 'daily-drift', title: 'Daily Drift', subtitle: 'Everyday knit-lattice sneaker',
  description: 'x', price: { amount: 128, currencyCode: 'USD' }, productType: 'Sneaker',
  tags: [], collections: ['everyday'], sizes: [42], features: [], fitNotes: '',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [{ value: 42, label: 'US 8.5' }],
}

describe('ProductCard', () => {
  it('links to detail and shows price + size hint', () => {
    render(<ProductCard product={p} />)
    const link = screen.getByRole('link', { name: /daily drift/i })
    expect(link).toHaveAttribute('href', '/product/daily-drift')
    expect(screen.getByText('$128.00')).toBeInTheDocument()
    expect(screen.getByText(/US 8\.5/)).toBeInTheDocument()
  })
})
