import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppBar } from './app-bar'
import { useWishlist, WishlistProvider } from '@/components/shop/wishlist-provider'

// 提供 toggle 入口：AppBar 自身只读计数，联动由 Provider 驱动。
function ToggleHarness({ handle }: { handle: string }) {
  const { toggle } = useWishlist()
  return (
    <button type="button" onClick={() => toggle(handle)}>
      toggle
    </button>
  )
}

describe('AppBar', () => {
  it('renders the brand, nav links and an empty wishlist count', () => {
    render(
      <WishlistProvider>
        <AppBar />
      </WishlistProvider>
    )

    expect(screen.getByRole('link', { name: 'Treadwell' })).toHaveAttribute('href', '/')

    const shop = screen.getByRole('link', { name: 'Shop' })
    expect(shop).toHaveAttribute('href', '/shop')

    const story = screen.getByRole('link', { name: 'Our Story' })
    expect(story).toHaveAttribute('href', '/#story')

    const wishlist = screen.getByRole('link', { name: /wishlist/i })
    expect(wishlist).toHaveAttribute('href', '/shop')
    expect(within(wishlist).getByText('0')).toBeInTheDocument()
  })

  it('shows an updated wishlist count when an item is added', async () => {
    const user = userEvent.setup()
    render(
      <WishlistProvider>
        <ToggleHarness handle="daily-drift" />
        <AppBar />
      </WishlistProvider>
    )

    const wishlist = screen.getByRole('link', { name: /wishlist/i })
    expect(within(wishlist).getByText('0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'toggle' }))

    expect(within(wishlist).getByText('1')).toBeInTheDocument()
  })
})
