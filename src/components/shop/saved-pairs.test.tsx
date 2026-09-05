// SavedPairs（/saved 清单页客户端）：空态（无请求）、加载、渲染行、移除、
// fetch 失败温和态。fetch 由 vi.stubGlobal 接管（jsdom 无网络）。
// WishlistProvider 持有模块级快照缓存：跨用例脏（已记录 footgun），故每例
// vi.resetModules + 动态导入组件，避免上例缓存污染本例子。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'

const seedRow = {
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'Unisex · 5 colorways',
  image: '/products/dc-1001/1.webp',
  colorCount: 5,
  photoCount: 4,
  sizeRange: 'US 4.5–9.5',
  storeAvailable: false,
}

let SavedPairs: ComponentType
let WishlistProvider: ComponentType<{ children: React.ReactNode }>

beforeEach(async () => {
  window.localStorage.clear()
  vi.resetModules()
  vi.unstubAllGlobals()
  ;({ SavedPairs } = await import('./saved-pairs'))
  ;({ WishlistProvider } = await import('./wishlist-provider'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

const stubFetch = (body: unknown[] = []) => {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const renderSaved = () =>
  render(
    <WishlistProvider>
      <SavedPairs />
    </WishlistProvider>,
  )

describe('SavedPairs (/saved)', () => {
  it('empty wishlist renders the empty state and does not fetch', () => {
    const fetchMock = stubFetch()
    renderSaved()
    expect(screen.getByText('Nothing saved yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the shop' })).toHaveAttribute('href', '/shop')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads rows via /api/catalog and links to each PDP', async () => {
    stubFetch([seedRow])
    window.localStorage.setItem('evoloop:wishlist', JSON.stringify(['dc-1001']))
    renderSaved()
    expect(await screen.findByText('Urban Bloom')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Urban Bloom/ })).toHaveAttribute(
      'href',
      '/product/dc-1001',
    )
    expect(screen.getByText(/US 4.5–9.5/)).toBeInTheDocument()
    expect(screen.getByText(/5 colors/)).toBeInTheDocument()
  })

  it('shows the on-the-store marker when the summary reports it', async () => {
    stubFetch([{ ...seedRow, storeAvailable: true }])
    window.localStorage.setItem('evoloop:wishlist', JSON.stringify(['dc-1001']))
    renderSaved()
    expect(await screen.findByText(/On the store/)).toBeInTheDocument()
  })

  it('removing a row toggles the wishlist store and refetches', async () => {
    const fetchMock = stubFetch([seedRow])
    window.localStorage.setItem('evoloop:wishlist', JSON.stringify(['dc-1001']))
    renderSaved()
    expect(await screen.findByText('Urban Bloom')).toBeInTheDocument()
    // 移除后 handle 列表空 → 空态（fetch 不再调用）
    fireEvent.click(screen.getByRole('button', { name: 'Remove Urban Bloom from saved' }))
    await waitFor(() => expect(screen.getByText('Nothing saved yet')).toBeInTheDocument())
    expect(window.localStorage.getItem('evoloop:wishlist')).toBe('[]')
    expect(fetchMock).toHaveBeenCalledTimes(1) // 空清单不再发请求
  })

  it('fetch failure shows a gentle error state (no crash)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    window.localStorage.setItem('evoloop:wishlist', JSON.stringify(['dc-1001']))
    renderSaved()
    expect(await screen.findByText(/couldn't load your saved pairs/i)).toBeInTheDocument()
  })
})
