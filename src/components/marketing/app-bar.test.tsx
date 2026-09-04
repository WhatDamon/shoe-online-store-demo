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

    expect(screen.getByRole('link', { name: 'Evoloop' })).toHaveAttribute('href', '/')

    const shop = screen.getByRole('link', { name: 'Shop' })
    expect(shop).toHaveAttribute('href', '/shop')

    const collections = screen.getByRole('link', { name: 'Collections' })
    expect(collections).toHaveAttribute('href', '/#collections')

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

  it('opens a mobile search row with an input and closes it via Escape', async () => {
    const user = userEvent.setup()
    render(
      <WishlistProvider>
        <AppBar />
      </WishlistProvider>
    )

    // 初始：展开按钮就绪（aria-expanded=false）；只有桌面内联搜索输入框
    // （type=search → searchbox 角色）。
    const openBtn = screen.getByRole('button', { name: 'Search', expanded: false })
    expect(screen.getAllByRole('searchbox', { name: 'Search products' })).toHaveLength(1)

    await user.click(openBtn)
    expect(openBtn).toHaveAttribute('aria-expanded', 'true')

    // 展开行：真实可输入的搜索框（桌面内联框之外的第二实例）。
    const inputs = screen.getAllByRole('searchbox', { name: 'Search products' })
    expect(inputs).toHaveLength(2)
    await user.type(inputs[1], 'running shoe')
    expect(inputs[1]).toHaveValue('running shoe')
    // 行内提交按钮与顶部开关同为 Search 名 → 应有 2 个。
    expect(screen.getAllByRole('button', { name: 'Search' })).toHaveLength(2)

    // Escape 关闭展开行（回到仅桌面内联输入框）。
    await user.keyboard('{Escape}')
    expect(screen.getAllByRole('searchbox', { name: 'Search products' })).toHaveLength(1)
    expect(openBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes the mobile search row via the cancel button', async () => {
    const user = userEvent.setup()
    render(
      <WishlistProvider>
        <AppBar />
      </WishlistProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Search', expanded: false }))
    expect(screen.getAllByRole('searchbox', { name: 'Search products' })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Close search' }))
    expect(screen.getAllByRole('searchbox', { name: 'Search products' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-expanded', 'false')
  })
})
