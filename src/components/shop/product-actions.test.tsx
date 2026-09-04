import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProductActions } from './product-actions'
import type { ProductView } from '@/server/catalog/service'

const p: ProductView = {
  id: 'p01',
  handle: 'daily-drift',
  title: 'Daily Drift',
  subtitle: 'Everyday knit-lattice sneaker',
  description: 'x',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [42, 43],
  features: [],
  fitNotes: '',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [
    { value: 42, label: 'US 8.5' },
    { value: 43, label: 'US 9' },
  ],
}

// 规格 §9（详情页顺序）：尺码选择器 → "Find my size" → 材质/合脚手风琴 → 主 CTA → 相关推荐。
// 本用例把该顺序固化在收口组件层：children（页面注入的手风琴）必须渲染在尺码区与购买条之间。
describe('ProductActions layout order (spec §9)', () => {
  it('renders size selector, then children slot, then buy CTA', () => {
    const { container } = render(
      <ProductActions product={p} buyUrl={null}>
        <div data-testid="accordion-slot">Materials &amp; fit</div>
      </ProductActions>,
    )

    const sizeLegend = screen.getByText('Select size')
    const findSize = screen.getByRole('button', { name: 'Find my size' })
    const slot = screen.getByTestId('accordion-slot')
    const cta = screen.getByRole('button', { name: 'Available soon' })

    const before = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

    expect(before(sizeLegend, findSize)).toBe(true)
    expect(before(findSize, slot)).toBe(true)
    expect(before(slot, cta)).toBe(true)
    expect(before(sizeLegend, cta)).toBe(true)

    // children 是 flex 容器的直接子节点之一（而非被隔离渲染），保持在同一文档流。
    expect(container.firstElementChild?.contains(slot)).toBe(true)
  })
})
