import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ProductVisual } from './product-visual'

const visual = { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 }

describe('ProductVisual', () => {
  it('renders an svg with product role and palette', () => {
    const { container } = render(<ProductVisual visual={visual} name="Daily Drift" />)
    const svg = container.querySelector('svg[data-product-visual]')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-label')).toBe('Daily Drift — printed shoe')
  })
  it('honors view prop to vary lattice density', () => {
    const { container } = render(<ProductVisual visual={visual} name="x" view="side" />)
    expect(container.querySelector('svg[data-view="side"]')).not.toBeNull()
  })
  it('renders every view for every construction pattern without crashing', () => {
    for (const view of ['side', 'sole', 'detail'] as const) {
      for (const pattern of ['lattice', 'wave', 'honeycomb'] as const) {
        const { container } = render(
          <ProductVisual
            visual={visual}
            name="x"
            view={view}
            construction={{ pattern, density: 0.75, printedUpper: true }}
          />,
        )
        const svg = container.querySelector('svg[data-product-visual]')
        expect(svg).not.toBeNull()
        expect(svg?.getAttribute('data-view')).toBe(view)
        expect(svg?.getAttribute('data-pattern')).toBe(pattern)
        expect(svg?.getAttribute('aria-label')).toBe('x — printed shoe')
      }
    }
  })
})
