import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('renders the buySlot in the CTA position instead of the BuyBar when provided', () => {
    const { container } = render(
      <ProductActions
        product={p}
        buyUrl={null}
        buySlot={<div data-testid="buy-slot">Buy on Shopify</div>}
      >
        <div data-testid="accordion-slot">Materials &amp; fit</div>
      </ProductActions>,
    )

    const slot = screen.getByTestId('accordion-slot')
    const buySlot = screen.getByTestId('buy-slot')
    // BuyBar 占位被替代：页面上不再有 "Available soon"
    expect(screen.queryByRole('button', { name: 'Available soon' })).toBeNull()

    const before = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(before(slot, buySlot)).toBe(true)
    expect(container.firstElementChild?.contains(buySlot)).toBe(true)
  })
})

const multiColor = {
  ...p,
  colors: [
    { name: 'Ink Black', hex: '#1a1a1a' },
    { name: 'Ivory', hex: '#f3ede2' },
    { name: 'Peach', hex: '#f5c8bd' },
  ],
}

describe('PDP colorway picker (decision #16: color selectable pre-order)', () => {
  it('hides the color picker for single-color or color-less products', () => {
    const { rerender } = render(<ProductActions product={p} buyUrl={null} />)
    expect(screen.queryByText('Color')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Black|Ivory/ })).not.toBeInTheDocument()

    rerender(
      <ProductActions
        product={{ ...p, colors: [{ name: 'Ivory', hex: '#f3ede2' }] }}
        buyUrl={null}
      />,
    )
    expect(screen.queryByText('Color')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Ivory' })).not.toBeInTheDocument()
  })

  it('shows one swatch per colorway and tracks the picked one in the legend', () => {
    render(<ProductActions product={multiColor} buyUrl={null} />)

    const ink = screen.getByRole('radio', { name: 'Ink Black' }) as HTMLInputElement
    const ivory = screen.getByRole('radio', { name: 'Ivory' }) as HTMLInputElement
    expect(ink.checked).toBe(true)
    expect(ivory.checked).toBe(false)
    // 图库未按颜色拆分：代表照片 + 色名标签，含诚实说明
    expect(
      screen.getByText('Photos are representative — the actual shade can vary on screen.'),
    ).toBeInTheDocument()

    fireEvent.click(ivory)
    expect(ivory.checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Ink Black' }) as HTMLInputElement).checked).toBe(
      false,
    )
    // legend 内选中色名（唯一可见文本实例）
    expect(screen.getByText('Ivory')).toBeInTheDocument()
  })
})
