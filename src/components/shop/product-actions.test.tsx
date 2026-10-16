import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProductActions } from './product-actions'
import { ProductGallery } from './product-gallery'
import { ProductColorSelectionProvider } from './product-color-selection'
import type { ProductView } from '@/domain/product'

beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ variants: [] }) }),
  ),
)
afterEach(() => vi.unstubAllGlobals())

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

// 详情页顺序：尺码选择器 → "Find my size" → 材质/合脚手风琴 → 主 CTA → 相关推荐。
// 本用例把该顺序固化在收口组件层：children（页面注入的手风琴）必须渲染在尺码区与购买条之间。
describe('ProductActions layout order', () => {
  it('renders size selector, then children slot, then buy CTA', () => {
    const { container } = render(
      <ProductActions product={p}>
        <div data-testid="accordion-slot">Materials &amp; fit</div>
      </ProductActions>,
    )

    const sizeLegend = screen.getByText('Select size')
    const findSize = screen.getByRole('button', { name: 'Find my size' })
    const slot = screen.getByTestId('accordion-slot')
    const cta = screen.getByRole('button', { name: 'Add to cart' })

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

const multiColor = {
  ...p,
  images: [
    '/products/daily-drift/1.webp',
    '/products/daily-drift/2.webp',
    '/products/daily-drift/3.webp',
  ],
  colors: [
    { name: 'Ink Black', hex: '#1a1a1a' },
    { name: 'Ivory', hex: '#f3ede2' },
    { name: 'Peach', hex: '#f5c8bd' },
  ],
}

describe('PDP colorway picker (decision #16: color selectable pre-order)', () => {
  it('resolves color and size to the backend variant ID, regardless of array ordering', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        variants: [
          {
            id: 'peach-43',
            color: 'Peach',
            size: 43,
            price: '59.00',
            currency: 'USD',
            available: 4,
          },
          {
            id: 'ivory-42',
            color: 'Ivory',
            size: 42,
            price: '63.00',
            currency: 'USD',
            available: 2,
          },
        ],
      }),
    })
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: '0.00', currency: 'USD' }),
    })
    vi.stubGlobal('fetch', fetcher)
    render(<ProductActions product={multiColor} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    await screen.findByText(/63.00/)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Added to cart.')
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/commerce/cart/items',
      expect.objectContaining({ body: JSON.stringify({ variant_id: 'ivory-42', quantity: 1 }) }),
    )
  })
  it('hides the color picker for single-color or color-less products', () => {
    const { rerender } = render(<ProductActions product={p} />)
    expect(screen.queryByText('Color')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Black|Ivory/ })).not.toBeInTheDocument()

    rerender(<ProductActions product={{ ...p, colors: [{ name: 'Ivory', hex: '#f3ede2' }] }} />)
    expect(screen.queryByText('Color')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Ivory' })).not.toBeInTheDocument()
  })

  it('shows one swatch per colorway and tracks the picked one in the legend', () => {
    render(<ProductActions product={multiColor} />)

    const ink = screen.getByRole('radio', { name: 'Ink Black' }) as HTMLInputElement
    const ivory = screen.getByRole('radio', { name: 'Ivory' }) as HTMLInputElement
    expect(ink.checked).toBe(true)
    expect(ivory.checked).toBe(false)
    expect(screen.getByText('Colors may vary slightly on screen.')).toBeInTheDocument()

    fireEvent.click(ivory)
    expect(ivory.checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Ink Black' }) as HTMLInputElement).checked).toBe(
      false,
    )
    // legend 内选中色名（唯一可见文本实例）
    expect(screen.getByText('Ivory')).toBeInTheDocument()
  })

  it('keeps the selected color and gallery image in sync', () => {
    render(
      <ProductColorSelectionProvider product={multiColor}>
        <ProductGallery product={multiColor} />
        <ProductActions product={multiColor} />
      </ProductColorSelectionProvider>,
    )

    expect(screen.getByRole('img', { name: 'Daily Drift in Ink Black' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))

    expect(screen.getByRole('img', { name: 'Daily Drift in Ivory' })).toHaveAttribute(
      'src',
      expect.stringContaining('2.webp'),
    )
    expect(screen.getByRole('button', { name: 'Show Ivory' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Peach' }))
    expect(screen.getByRole('radio', { name: 'Peach' })).toBeChecked()
  })
})

// 购买通道收敛（2026-10-13 切片 A）：目录只剩「本站变体 + 加购」一条路径，「商店直购」
// 形态（buyConfig / Buy Button）已下线。
// 这是刻意的特征测试（characterization）：删除型改动在本文件里没有可失败的运行时断言，
// 本任务真正的红灯在 api/catalog 载荷 shape、catalog 来源选择与 saved-pairs 三处。
describe('ProductActions purchase channel', () => {
  it('renders the demo buy bar with no store purchase channel', () => {
    render(<ProductActions product={multiColor} />)
    expect(screen.getByText('Select size')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeInTheDocument()
  })
})
