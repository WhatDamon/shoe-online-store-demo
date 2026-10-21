import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ProductBuyBar } from './product-buy-bar'
import type { CommerceVariant } from '@/domain/commerce'

const variant = {
  id: 'variant-ivory-42',
  color: 'Ivory',
  color_hex: '#f3ede2',
  size: 42,
  price: '59.00',
  currency: 'USD',
  available: 10,
} satisfies CommerceVariant
const props = { variant, selectedLabel: 'US 8.5', colorName: 'Ivory', loading: false, error: null }
const cart = { items: [], total: '0.00', currency: 'USD' }
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

function mockCart() {
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (url === cartUrl && init?.method === 'POST') return response(cart)
    throw new Error(`未配置的测试请求：${String(url)}`)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

beforeEach(() => {
  mockCart()
})
afterEach(() => vi.unstubAllGlobals())

describe('ProductBuyBar Python 购物车入口', () => {
  it.each([
    { label: '没有已选变体', overrides: { variant: null } },
    { label: '目录仍在加载', overrides: { loading: true } },
    { label: '目录错误但仍有旧变体', overrides: { error: 'Catalog offline' } },
    { label: '所选变体零库存', overrides: { variant: { ...variant, available: 0 } } },
  ])('$label 时按钮禁用且点击不产生 POST', ({ overrides }) => {
    const fetcher = mockCart()
    render(<ProductBuyBar {...props} {...overrides} />)
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.queryByText('Added to cart.')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('未选尺码时要求选择，加载时展示加载状态', () => {
    const { rerender } = render(<ProductBuyBar {...props} variant={null} selectedLabel={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Choose a color and size.')
    rerender(<ProductBuyBar {...props} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading available options...')
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })

  it('所选变体决定价格货币和库存，切换后不残留旧价格', () => {
    const { rerender } = render(<ProductBuyBar {...props} />)
    expect(screen.getByText(/USD 59\.00.*10 available/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Ivory · US 8.5 selected')
    rerender(
      <ProductBuyBar
        {...props}
        variant={{
          ...variant,
          id: 'sage-44',
          color: 'Sage',
          color_hex: '#a3b18a',
          size: 44,
          price: '73.00',
          currency: 'EUR',
          available: 0,
        }}
        selectedLabel="EU 44"
        colorName="Sage"
      />,
    )
    expect(screen.getByText(/EUR 73\.00.*0 available/)).toBeInTheDocument()
    expect(screen.queryByText(/USD 59\.00/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })

  it('仅提交变体 ID 和数量，成功后显示状态和购物车入口', async () => {
    const fetcher = mockCart()
    render(<ProductBuyBar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Added to cart.')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      cartUrl,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ variant_id: variant.id, quantity: 1 }),
      }),
    )
    expect(screen.getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart')
    expect(screen.queryByRole('button', { name: 'Recheck availability' })).not.toBeInTheDocument()
  })

  it('已有目录错误时点击重新核验只调用回调，不提交旧变体', () => {
    const fetcher = mockCart()
    const onRecheck = vi.fn()
    render(<ProductBuyBar {...props} error="Catalog offline" onRecheck={onRecheck} />)
    expect(screen.getByRole('status')).toHaveTextContent('Catalog offline')
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Recheck availability' }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('ProductBuyBar 忙碌状态与重复点击', () => {
  it('同一批双击只提交一次，完成前禁用按钮并通知 busy 回调', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetcher = mockCart()
    fetcher.mockImplementationOnce(() => pending.promise)
    const onBusyChange = vi.fn()
    render(<ProductBuyBar {...props} onBusyChange={onBusyChange} />)
    const add = screen.getByRole('button', { name: 'Add to cart' })
    act(() => {
      fireEvent.click(add)
      fireEvent.click(add)
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Adding/ })).toBeDisabled()
    expect(onBusyChange).toHaveBeenCalledWith(true)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(screen.queryByText('Added to cart.')).not.toBeInTheDocument()
    await act(async () => pending.resolve(response(cart)))
    expect(await screen.findByText('Added to cart.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('请求失败后释放 busy 状态但继续禁买，直到父级重新核验', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    const fetcher = mockCart()
    fetcher.mockImplementationOnce(() => pending.promise)
    const onBusyChange = vi.fn()
    const onRecheck = vi.fn()
    render(<ProductBuyBar {...props} onBusyChange={onBusyChange} onRecheck={onRecheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    await act(async () => pending.reject(new Error('Service offline')))
    expect(await screen.findByText('Service offline')).toBeInTheDocument()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Recheck availability' }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('ProductBuyBar 任意加入失败都必须重新核验', () => {
  it.each([
    {
      label: '网络异常',
      request: async () => {
        throw new Error('Service offline')
      },
      message: /Service offline/,
    },
    {
      label: '库存拒绝',
      request: async () => response({ code: 'insufficient_stock' }, false),
      message: /Not enough stock/,
    },
    {
      label: '未知 HTTP 错误',
      request: async () => response({ code: 'unknown_error' }, false),
      message: /couldn't complete that action/i,
    },
    {
      label: '成功响应结构非法',
      request: async () => response({}),
      message: /invalid response/i,
    },
    {
      label: '响应 JSON 无法解析',
      request: async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Invalid JSON')
        },
      }),
      message: /invalid response/i,
    },
  ])('$label 后禁买，显示核验按钮，点击不会自动重放 POST', async ({ request, message }) => {
    const fetcher = mockCart()
    fetcher.mockImplementationOnce(request)
    const onRecheck = vi.fn()
    const { rerender } = render(<ProductBuyBar {...props} onRecheck={onRecheck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('Added to cart.')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()

    // 换一条旧目录中的可售变体，也不能绕过失败后的重新核验。
    rerender(
      <ProductBuyBar
        {...props}
        variant={{ ...variant, id: 'peach-42', color: 'Peach', color_hex: '#f5c8bd' }}
        colorName="Peach"
        onRecheck={onRecheck}
      />,
    )
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Recheck availability' }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Added to cart.')).not.toBeInTheDocument()
  })

  it('省略可选回调仍可加入，失败后也不能直接再次 POST', async () => {
    const fetcher = mockCart()
    fetcher.mockRejectedValueOnce(new Error('Service offline'))
    render(<ProductBuyBar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await screen.findByText('Service offline')
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
