import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProductActions } from './product-actions'
import { ProductGallery } from './product-gallery'
import { ProductColorSelectionProvider } from './product-color-selection'
import type { CommerceProduct } from '@/domain/commerce'
import type { ProductView, SizeSystem } from '@/domain/product'

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

const multiColor: ProductView = {
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

// Python 与展示目录故意错序、缺色缺码且价格不同，避免数组下标或展示价格冒充交易真值。
const pythonProduct = {
  variants: [
    {
      id: 'peach-43',
      color: 'Peach',
      color_hex: '#f5c8bd',
      size: 43,
      price: '59.00',
      currency: 'USD',
      available: 4,
    },
    {
      id: 'ivory-42',
      color: 'Ivory',
      color_hex: '#f3ede2',
      size: 42,
      price: '63.00',
      currency: 'USD',
      available: 2,
    },
    {
      id: 'peach-42',
      color: 'Peach',
      color_hex: '#f5c8bd',
      size: 42,
      price: '61.00',
      currency: 'USD',
      available: 6,
    },
    {
      id: 'sage-44',
      color: 'Sage',
      color_hex: '#a3b18a',
      size: 44,
      price: '71.00',
      currency: 'USD',
      available: 0,
    },
  ],
  media: [
    { color: 'Ivory', url: '/products/daily-drift/2.webp' },
    { color: null, url: '/products/daily-drift/1.webp' },
    { color: 'Peach', url: '/products/daily-drift/3.webp' },
  ],
} satisfies CommerceProduct

const nextProduct: ProductView = { ...multiColor, id: 'p02', handle: 'coastal-step' }
const nextCatalog = {
  variants: [
    {
      id: 'ocean-44',
      color: 'Ocean',
      color_hex: '#24546b',
      size: 44,
      price: '82.00',
      currency: 'USD',
      available: 3,
    },
  ],
  media: [],
} satisfies CommerceProduct
const cart = { items: [], total: '0.00', currency: 'USD' }
const catalogUrl = '/api/commerce/catalog/products/daily-drift'
const nextCatalogUrl = '/api/commerce/catalog/products/coastal-step'
const cartUrl = '/api/commerce/cart/items'
const response = (data: unknown, ok = true) => ({ ok, json: async () => data })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mockCommerce(catalog: CommerceProduct = pythonProduct) {
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (url === catalogUrl && (!init?.method || init.method === 'GET')) return response(catalog)
    if (url === cartUrl && init?.method === 'POST') return response(cart)
    throw new Error(`未配置的测试请求：${String(url)}`)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function sizeRadios() {
  return screen.queryAllByRole('radio', { name: /^(US|EU) / })
}

beforeEach(() => {
  mockCommerce()
})
afterEach(() => vi.unstubAllGlobals())

describe('ProductActions 布局回归', () => {
  it('保持尺码、Find my size、children 和购买按钮的顺序', async () => {
    const { container } = render(
      <ProductActions product={p} buyUrl={null}>
        <div data-testid="accordion-slot">Materials &amp; fit</div>
      </ProductActions>,
    )
    await screen.findByRole('radio', { name: 'US 8.5' })

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
    expect(container.firstElementChild?.contains(slot)).toBe(true)
  })
})

describe('ProductActions 由 Python 变体驱动选择', () => {
  it('目录返回前禁止购买，返回后选中 Python 第一个颜色而不自动选码', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetcher = mockCommerce()
    fetcher.mockImplementationOnce(() => pending.promise)
    render(
      <ProductActions
        product={{
          ...multiColor,
          sizeOptions: [
            { value: 42, label: 'EU 42' },
            { value: 43, label: 'EU 43' },
          ],
        }}
        buyUrl={null}
      />,
    )

    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    expect(sizeRadios()).toHaveLength(0)
    fireEvent.click(add)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve(response(pythonProduct)))
    expect(await screen.findByRole('radio', { name: 'Peach' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Ivory' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Sage' })).not.toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Ink Black' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio', { name: 'Peach' })).toHaveLength(1)
    expect(sizeRadios()).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'US 8.5' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'US 9' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'EU 42' })).not.toBeInTheDocument()
    for (const size of sizeRadios()) expect(size).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    expect(screen.queryByText(/USD 128/)).not.toBeInTheDocument()
  })

  it('按所选变体展示 Python 价格库存并且只 POST 真实 ID 和数量', async () => {
    const fetcher = mockCommerce()
    render(<ProductActions product={multiColor} buyUrl={null} />)
    await screen.findByRole('radio', { name: 'Peach' })

    fireEvent.click(screen.getByRole('radio', { name: 'US 9' }))
    expect(screen.getByText(/USD 59\.00.*4 available/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    expect(screen.getByText(/USD 61\.00.*6 available/)).toBeInTheDocument()
    expect(screen.queryByText(/USD 59\.00/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    expect(screen.getByRole('radio', { name: 'US 8.5' })).toBeChecked()
    expect(screen.getByText(/USD 63\.00.*2 available/)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'US 9' })).not.toBeInTheDocument()
    expect(screen.queryByText(/USD 61\.00|USD 128/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Added to cart.')).toBeInTheDocument()
    expect(fetcher).toHaveBeenLastCalledWith(
      cartUrl,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ variant_id: 'ivory-42', quantity: 1 }),
      }),
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('新颜色没有旧尺码时清空选择和 ID，切回也必须再次选码', async () => {
    const fetcher = mockCommerce()
    render(<ProductActions product={multiColor} buyUrl={null} />)
    await screen.findByRole('radio', { name: 'Peach' })
    fireEvent.click(screen.getByRole('radio', { name: 'US 9' }))
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled()

    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    expect(screen.getByRole('radio', { name: 'US 8.5' })).not.toBeChecked()
    expect(screen.queryByRole('radio', { name: 'US 9' })).not.toBeInTheDocument()
    expect(screen.queryByText(/USD 59\.00/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(fetcher).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('radio', { name: 'Peach' }))
    for (const size of sizeRadios()) expect(size).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Added to cart.')
    expect(fetcher).toHaveBeenLastCalledWith(
      cartUrl,
      expect.objectContaining({ body: JSON.stringify({ variant_id: 'peach-42', quantity: 1 }) }),
    )
  })

  it('展示目录缺失的 Python 颜色和尺码仍可选择，零库存禁止 POST', async () => {
    const fetcher = mockCommerce()
    render(<ProductActions product={multiColor} buyUrl={null} />)
    await screen.findByRole('radio', { name: 'Sage' })
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Sage' }))

    expect(sizeRadios()).toHaveLength(1)
    const size = screen.getByRole('radio', { name: 'US 9.5' })
    expect(size).not.toBeChecked()
    fireEvent.click(size)
    expect(screen.getByText(/USD 71\.00.*0 available/)).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each<SizeSystem>(['US', 'EU'])('使用显式 %s 尺码体系生成 Python 尺码标签', async (system) => {
    render(
      <ProductActions
        product={{ ...multiColor, sizes: [], sizeOptions: [] }}
        buyUrl={null}
        sizeSystem={system}
      />,
    )
    const firstLabel = system === 'US' ? 'US 8.5' : 'EU 42'
    const secondLabel = system === 'US' ? 'US 9' : 'EU 43'
    await screen.findByRole('radio', { name: firstLabel })
    expect(screen.getByRole('radio', { name: secondLabel })).toBeInTheDocument()
    expect(sizeRadios()).toHaveLength(2)
    expect(
      screen.queryByRole('radio', { name: system === 'US' ? 'EU 42' : 'US 8.5' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: firstLabel }))
    expect(screen.getByRole('status')).toHaveTextContent(firstLabel)
    expect(screen.getByText(/USD 61\.00.*6 available/)).toBeInTheDocument()
  })

  it.each([p, multiColor])(
    'Python 单色时隐藏色卡且不受展示颜色数量影响：$handle',
    async (product) => {
      const fetcher = mockCommerce({
        variants: pythonProduct.variants.filter((v) => v.color === 'Peach'),
        media: pythonProduct.media,
      })
      render(<ProductActions product={product} buyUrl={null} />)
      await screen.findByRole('radio', { name: 'US 9' })
      expect(
        screen.queryByRole('radio', { name: /Peach|Ivory|Ink Black|Sage/ }),
      ).not.toBeInTheDocument()
      for (const size of sizeRadios()) expect(size).not.toBeChecked()
      fireEvent.click(screen.getByRole('radio', { name: 'US 9' }))
      expect(screen.getByRole('status')).toHaveTextContent('Peach')
      fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
      await screen.findByText('Added to cart.')
      expect(fetcher).toHaveBeenLastCalledWith(
        cartUrl,
        expect.objectContaining({ body: JSON.stringify({ variant_id: 'peach-43', quantity: 1 }) }),
      )
    },
  )

  it('Python 空 variants 时不回落到展示色码或价格', async () => {
    const fetcher = mockCommerce({ variants: [], media: [] })
    render(<ProductActions product={multiColor} buyUrl={null} />)
    await waitFor(() =>
      expect(screen.queryByText('Loading available options...')).not.toBeInTheDocument(),
    )
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryByText(/USD 128/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find my size' })).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('ProductActions 图库单向联动', () => {
  it('同 handle 的展示图片更新不重新加载或重置交易选择', async () => {
    const fetcher = mockCommerce()
    const view = (product: ProductView) => (
      <ProductColorSelectionProvider product={product}>
        <ProductGallery product={product} />
        <ProductActions product={product} buyUrl={null} />
      </ProductColorSelectionProvider>
    )
    const { rerender } = render(view(multiColor))
    fireEvent.click(await screen.findByRole('radio', { name: 'Ivory' }))
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    rerender(view({ ...multiColor, images: [...multiColor.images!] }))
    await act(async () => {})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('radio', { name: 'Ivory' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'US 8.5' })).toBeChecked()
    expect(screen.getByText(/USD 63\.00.*2 available/)).toBeInTheDocument()
    rerender(view({ ...multiColor, images: [multiColor.images![0], multiColor.images![2]] }))
    expect(screen.getByRole('button', { name: 'Show photo 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Ivory' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Added to cart.')
    expect(fetcher).toHaveBeenLastCalledWith(
      cartUrl,
      expect.objectContaining({ body: JSON.stringify({ variant_id: 'ivory-42', quantity: 1 }) }),
    )
  })

  it('再次点击已选颜色重新聚焦图片并保持同一个交易变体', async () => {
    const fetcher = mockCommerce()
    render(
      <ProductColorSelectionProvider product={multiColor}>
        <ProductGallery product={multiColor} />
        <ProductActions product={multiColor} buyUrl={null} />
      </ProductColorSelectionProvider>,
    )
    fireEvent.click(await screen.findByRole('radio', { name: 'Ivory' }))
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show photo 3' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    expect(screen.getByRole('button', { name: 'Show photo 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'US 8.5' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Added to cart.')
    expect(fetcher).toHaveBeenLastCalledWith(
      cartUrl,
      expect.objectContaining({ body: JSON.stringify({ variant_id: 'ivory-42', quantity: 1 }) }),
    )
  })

  it('按 Python media.color 和展示图片 URL 定位，不按颜色数组下标定位', async () => {
    render(
      <ProductColorSelectionProvider product={multiColor}>
        <ProductGallery product={multiColor} />
        <ProductActions product={multiColor} buyUrl={null} />
      </ProductColorSelectionProvider>,
    )
    await screen.findByRole('radio', { name: 'Peach' })
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /^Daily Drift/ })).toHaveAttribute(
        'src',
        expect.stringContaining('3.webp'),
      ),
    )
    expect(screen.getByRole('button', { name: 'Show photo 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    expect(screen.getByRole('img', { name: /^Daily Drift/ })).toHaveAttribute(
      'src',
      expect.stringContaining('2.webp'),
    )
    expect(screen.getByRole('button', { name: 'Show photo 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it.each([
    { label: '颜色没有 media', media: pythonProduct.media },
    {
      label: 'media URL 不在展示图片中',
      media: [...pythonProduct.media, { color: 'Sage', url: '/products/missing.webp' }],
    },
  ])('$label 时回到默认首图', async ({ media }) => {
    mockCommerce({ ...pythonProduct, media })
    render(
      <ProductColorSelectionProvider product={multiColor}>
        <ProductGallery product={multiColor} />
        <ProductActions product={multiColor} buyUrl={null} />
      </ProductColorSelectionProvider>,
    )
    await screen.findByRole('radio', { name: 'Sage' })
    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    expect(screen.getByRole('button', { name: 'Show photo 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Sage' }))
    expect(screen.getByRole('img', { name: /^Daily Drift/ })).toHaveAttribute(
      'src',
      expect.stringContaining('1.webp'),
    )
    expect(screen.getByRole('button', { name: 'Show photo 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Sage' })).toBeChecked()
  })

  it('缩略图统一使用 Show photo N，只切图，购物车仍 POST 原变体 ID', async () => {
    const fetcher = mockCommerce()
    render(
      <ProductColorSelectionProvider product={multiColor}>
        <ProductGallery product={multiColor} />
        <ProductActions product={multiColor} buyUrl={null} />
      </ProductColorSelectionProvider>,
    )
    await screen.findByRole('radio', { name: 'Ivory' })
    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    expect(screen.getAllByRole('button', { name: /^Show photo \d+$/ })).toHaveLength(3)
    expect(
      screen.queryByRole('button', { name: /^Show (Ivory|Peach|Ink Black)$/ }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show photo 3' }))
    expect(screen.getByRole('img', { name: /^Daily Drift/ })).toHaveAttribute(
      'src',
      expect.stringContaining('3.webp'),
    )
    expect(screen.getByRole('button', { name: 'Show photo 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Ivory' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'US 8.5' })).toBeChecked()
    expect(screen.getByText(/USD 63\.00.*2 available/)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Added to cart.')
    expect(fetcher).toHaveBeenLastCalledWith(
      cartUrl,
      expect.objectContaining({ body: JSON.stringify({ variant_id: 'ivory-42', quantity: 1 }) }),
    )
  })
})

describe('ProductActions 目录错误与重新核验', () => {
  it.each([
    { label: '缺少 variants', data: { media: [] } },
    { label: '缺少 media', data: { variants: pythonProduct.variants } },
    {
      label: '变体缺少 color_hex',
      data: {
        variants: [
          { id: 'bad-42', color: 'Peach', size: 42, price: '59.00', currency: 'USD', available: 1 },
        ],
        media: [],
      },
    },
    {
      label: '库存非法',
      data: { ...pythonProduct, variants: [{ ...pythonProduct.variants[0], available: -1 }] },
    },
  ])('$label 的目录不展示交易选项，禁止购买并允许重新核验', async ({ data }) => {
    const fetcher = mockCommerce()
    fetcher.mockResolvedValueOnce(response(data))
    render(<ProductActions product={multiColor} buyUrl={null} />)
    expect(await screen.findByText(/invalid response/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(fetcher).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Recheck availability' }))
    await screen.findByRole('radio', { name: 'Peach' })
    expect(screen.queryByText(/invalid response/i)).not.toBeInTheDocument()
    for (const size of sizeRadios()) expect(size).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(
      fetcher.mock.calls.every(([url, init]) => url === catalogUrl && init?.method !== 'POST'),
    ).toBe(true)
  })

  it.each(['网络失败', 'HTTP 错误'])(
    '%s 后重新核验只 GET 目录，不自动加入购物车',
    async (failure) => {
      const pending = deferred<ReturnType<typeof response>>()
      const fetcher = mockCommerce()
      if (failure === '网络失败') fetcher.mockRejectedValueOnce(new Error('Catalog offline'))
      else fetcher.mockResolvedValueOnce(response({ code: 'backend_unavailable' }, false))
      fetcher.mockImplementationOnce(() => pending.promise)
      render(<ProductActions product={multiColor} buyUrl={null} />)

      const recheck = await screen.findByRole('button', { name: 'Recheck availability' })
      expect(screen.getByRole('status')).toHaveTextContent(
        /Catalog offline|temporarily unavailable/,
      )
      expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
      fireEvent.click(recheck)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
      await act(async () => pending.resolve(response(pythonProduct)))
      await screen.findByRole('radio', { name: 'Peach' })
      for (const size of sizeRadios()) expect(size).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(
        fetcher.mock.calls.every(([url, init]) => url === catalogUrl && init?.method !== 'POST'),
      ).toBe(true)
    },
  )

  it('加入失败后锁住购买，核验更新目录后必须重新选码且绝不自动重放 POST', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const refreshed = {
      ...pythonProduct,
      variants: pythonProduct.variants.map((v) =>
        v.id === 'ivory-42' ? { ...v, id: 'ivory-42-rechecked', price: '75.00', available: 1 } : v,
      ),
    }
    const fetcher = mockCommerce()
    fetcher
      .mockResolvedValueOnce(response(pythonProduct))
      .mockResolvedValueOnce(response({ code: 'insufficient_stock' }, false))
      .mockImplementationOnce(() => pending.promise)
    render(<ProductActions product={multiColor} buyUrl={null} />)
    await screen.findByRole('radio', { name: 'Ivory' })
    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    const recheck = await screen.findByRole('button', { name: 'Recheck availability' })
    expect(screen.queryByText('Added to cart.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    fireEvent.click(recheck)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[2][0]).toBe(catalogUrl)
    expect(fetcher.mock.calls[2][1]?.method).not.toBe('POST')
    await act(async () => pending.resolve(response(refreshed)))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'US 8.5' })).toBeEnabled())
    for (const size of sizeRadios()) expect(size).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('radio', { name: 'Ivory' }))
    fireEvent.click(screen.getByRole('radio', { name: 'US 8.5' }))
    expect(screen.getByText(/USD 75\.00.*1 available/)).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Added to cart.')
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher).toHaveBeenLastCalledWith(
      cartUrl,
      expect.objectContaining({
        body: JSON.stringify({ variant_id: 'ivory-42-rechecked', quantity: 1 }),
      }),
    )
  })

  it('忙碌时禁用颜色和尺码，同一批双击只产生一个 POST', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetcher = mockCommerce()
    fetcher
      .mockResolvedValueOnce(response(pythonProduct))
      .mockImplementationOnce(() => pending.promise)
    render(<ProductActions product={multiColor} buyUrl={null} />)
    await screen.findByRole('radio', { name: 'Peach' })
    fireEvent.click(screen.getByRole('radio', { name: 'US 9' }))
    const add = screen.getByRole('button', { name: 'Add to cart' })
    act(() => {
      fireEvent.click(add)
      fireEvent.click(add)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(add).toBeDisabled()
    for (const selector of screen.getAllByRole('radio')) expect(selector).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Peach' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'US 9' })).toBeChecked()
    await act(async () => pending.resolve(response(cart)))
    await screen.findByText('Added to cart.')
    for (const selector of screen.getAllByRole('radio')) expect(selector).toBeEnabled()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('ProductActions 切换 handle 隔离', () => {
  it('新目录尚未返回时立即清除旧选项、价格和选择', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetcher = mockCommerce()
    const { rerender } = render(<ProductActions product={multiColor} buyUrl={null} />)
    await screen.findByRole('radio', { name: 'Peach' })
    fireEvent.click(screen.getByRole('radio', { name: 'US 9' }))
    expect(screen.getByText(/USD 59\.00/)).toBeInTheDocument()
    fetcher.mockImplementationOnce(() => pending.promise)
    rerender(<ProductActions product={nextProduct} buyUrl={null} />)

    expect(screen.queryByRole('radio', { name: 'Peach' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'US 9' })).not.toBeInTheDocument()
    expect(screen.queryByText(/USD 59\.00/)).not.toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0]).toBe(nextCatalogUrl)
    await act(async () => pending.resolve(response(nextCatalog)))
    const size = await screen.findByRole('radio', { name: 'US 9.5' })
    expect(size).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    fireEvent.click(size)
    expect(screen.getByText(/USD 82\.00.*3 available/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Added to cart.')
    expect(fetcher).toHaveBeenLastCalledWith(
      cartUrl,
      expect.objectContaining({ body: JSON.stringify({ variant_id: 'ocean-44', quantity: 1 }) }),
    )
  })

  it.each(['延迟成功', '延迟失败', '取消请求'])(
    '忽略旧 handle 的%s，保持新目录和选择',
    async (outcome) => {
      const oldRequest = deferred<ReturnType<typeof response>>()
      const fetcher = mockCommerce()
      fetcher
        .mockImplementationOnce(() => oldRequest.promise)
        .mockResolvedValueOnce(response(nextCatalog))
      const { rerender } = render(<ProductActions product={multiColor} buyUrl={null} />)
      rerender(<ProductActions product={nextProduct} buyUrl={null} />)
      fireEvent.click(await screen.findByRole('radio', { name: 'US 9.5' }))

      await act(async () => {
        if (outcome === '延迟成功') {
          oldRequest.resolve(response(pythonProduct))
        } else if (outcome === '取消请求') {
          oldRequest.reject(new DOMException('Old request aborted', 'AbortError'))
        } else {
          oldRequest.reject(new Error('Old catalog offline'))
        }
      })
      expect(screen.getByRole('radio', { name: 'US 9.5' })).toBeChecked()
      expect(screen.queryByRole('radio', { name: 'Peach' })).not.toBeInTheDocument()
      expect(screen.queryByText(/Old catalog offline|Old request aborted/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Recheck availability' })).not.toBeInTheDocument()
      expect(screen.getByText(/USD 82\.00.*3 available/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
      await screen.findByText('Added to cart.')
      expect(fetcher).toHaveBeenLastCalledWith(
        cartUrl,
        expect.objectContaining({ body: JSON.stringify({ variant_id: 'ocean-44', quantity: 1 }) }),
      )
    },
  )

  it.each(['目录错误', '加入失败'])('切换 handle 时立即清除旧%s和重新核验提示', async (failure) => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetcher = mockCommerce()
    if (failure === '目录错误') fetcher.mockRejectedValueOnce(new Error('Old catalog offline'))
    else
      fetcher
        .mockResolvedValueOnce(response(pythonProduct))
        .mockRejectedValueOnce(new Error('Old add failed'))
    const { rerender } = render(<ProductActions product={multiColor} buyUrl={null} />)
    if (failure === '加入失败') {
      fireEvent.click(await screen.findByRole('radio', { name: 'US 9' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    }
    await screen.findByRole('button', { name: 'Recheck availability' })
    fetcher.mockImplementationOnce(() => pending.promise)
    rerender(<ProductActions product={nextProduct} buyUrl={null} />)

    expect(screen.queryByText(/Old catalog offline|Old add failed/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recheck availability' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    await act(async () => pending.resolve(response(nextCatalog)))
    expect(await screen.findByRole('radio', { name: 'US 9.5' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })
})

const storeCfg = {
  productId: '9407853625559',
  domain: 'demo.myshopify.com',
  storefrontAccessToken: 'tok',
  moneyFormat: '¥{{amount}}',
}

describe('ProductActions 休眠 Shopify 回归', () => {
  it('buyConfig 分支隐藏选择器和本站购买条，保留 Find my size 和 children 且不调用 fetch', async () => {
    const fetcher = mockCommerce()
    const { container } = render(
      <ProductActions product={multiColor} buyUrl={null} buyConfig={storeCfg}>
        <div data-testid="accordion-slot">Materials &amp; fit</div>
      </ProductActions>,
    )
    await act(async () => {})
    expect(screen.queryByText('Select size')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    for (const button of screen.queryAllByRole('button', { name: /Add to cart|Buy now/ })) {
      expect(button).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'Find my size' })).toBeInTheDocument()
    expect(screen.getByTestId('accordion-slot')).toBeInTheDocument()
    expect(container.querySelector('.shopify-buy[data-product-id="9407853625559"]')).not.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('buyConfig 为 null 时继续使用 Python 选择器和本站购买按钮', async () => {
    const fetcher = mockCommerce()
    render(<ProductActions product={multiColor} buyUrl={null} buyConfig={null} />)
    await screen.findByRole('radio', { name: 'Peach' })
    expect(screen.getByText('Select size')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledWith(catalogUrl, expect.any(Object))
  })
})
