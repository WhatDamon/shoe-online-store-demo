// AI 结果卡收藏：心形（Save pair）与主区 Link 分离（无嵌套交互）；无 WishlistProvider
// 时（孤立渲染）不渲染心形；Provider 存在时点击 toggle 同一 localStorage store。
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProductResultCard } from './product-result-card'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import type { ProductCard as CardEvent } from '@/server/ai/events'

const card: CardEvent = {
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'Everyday · 5 colors',
  image: null,
  imageKind: 'svg',
  photoCount: 0,
  sizeRange: 'US 4.5–9.5',
  colorCount: 5,
  palette: ['#111111', '#0f766e'],
}

describe('ProductResultCard wishlist (Save pair)', () => {
  it('renders the main area as a link to the PDP', () => {
    render(<ProductResultCard item={card} />)
    expect(screen.getByRole('link', { name: /Urban Bloom/ })).toHaveAttribute(
      'href',
      '/product/dc-1001',
    )
  })

  it('hides the save heart when no WishlistProvider is mounted (isolated render)', () => {
    render(<ProductResultCard item={card} />)
    expect(screen.queryByRole('button', { name: /wishlist/i })).not.toBeInTheDocument()
  })

  it('toggles the shared wishlist store via the heart (add → remove)', () => {
    render(
      <WishlistProvider>
        <ProductResultCard item={card} />
      </WishlistProvider>,
    )
    const add = screen.getByRole('button', { name: 'Add to wishlist' })
    fireEvent.click(add)
    expect(screen.getByRole('button', { name: 'Remove from wishlist' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(window.localStorage.getItem('evoloop:wishlist')).toContain('dc-1001')
    fireEvent.click(screen.getByRole('button', { name: 'Remove from wishlist' }))
    expect(screen.getByRole('button', { name: 'Add to wishlist' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(window.localStorage.getItem('evoloop:wishlist')).toBe('[]')
  })

  it('heart click does not navigate (separate from the Link)', () => {
    render(
      <WishlistProvider>
        <ProductResultCard item={card} />
      </WishlistProvider>,
    )
    // 心形是 button，非 Link 内嵌 → 点击不触发导航
    const heart = screen.getByRole('button', { name: 'Add to wishlist' })
    expect(heart.closest('a')).toBeNull()
    fireEvent.click(heart)
    expect(screen.getByRole('link', { name: /Urban Bloom/ })).toBeInTheDocument()
  })
})
