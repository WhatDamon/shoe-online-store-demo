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
      </WishlistProvider>,
    )

    expect(screen.getByRole('link', { name: 'Evoloop' })).toHaveAttribute('href', '/')

    // 桌面主导航（Main）：移动菜单（原生 details）的链接在 jsdom 无 CSS/UA
    // 隐藏语义，会与 Main 重复，故按导航作用域断言，避免歧义。
    const mainNav = screen.getByRole('navigation', { name: 'Main' })
    const shop = within(mainNav).getByRole('link', { name: 'Shop' })
    expect(shop).toHaveAttribute('href', '/shop')

    const collections = within(mainNav).getByRole('link', { name: 'Collections' })
    expect(collections).toHaveAttribute('href', '/#collections')

    const story = within(mainNav).getByRole('link', { name: 'Our Story' })
    expect(story).toHaveAttribute('href', '/#story')

    const blog = within(mainNav).getByRole('link', { name: 'Blog' })
    expect(blog).toHaveAttribute('href', '/blog')

    const wishlist = screen.getByRole('link', { name: /wishlist/i })
    expect(wishlist).toHaveAttribute('href', '/shop')
    expect(within(wishlist).getByText('0')).toBeInTheDocument()
  })

  it('opens the mobile menu via the native details disclosure with nav links', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <WishlistProvider>
        <AppBar />
      </WishlistProvider>,
    )

    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    // jsdom 的 a11y 树不把 <summary> 映射为 button 角色（真实浏览器为标准
    // disclosure 控件且接受 aria-label），故用 DOM 级查询触发原生切换。
    const summary = details!.querySelector('summary') as HTMLElement
    await user.click(summary)

    // 原生 disclosure：点击后 open 属性置位，面板链接可用（jsdom 30 实现
    // details/summary 的原生切换；真实浏览器中关闭态内容由 UA 隐藏）。
    expect(details).toHaveAttribute('open')
    const nav = screen.getByRole('navigation', { name: 'Mobile' })
    for (const [label, href] of [
      ['Shop', '/shop'],
      ['Collections', '/#collections'],
      ['Our Story', '/#story'],
      ['Blog', '/blog'],
    ] as const) {
      const link = within(nav).getByRole('link', { name: label })
      expect(link).toHaveAttribute('href', href)
    }

    // JS 增强：点击导航链接后收起面板（removeAttribute('open')）
    await user.click(within(nav).getByRole('link', { name: 'Collections' }))
    expect(details).not.toHaveAttribute('open')
  })

  it('shows an updated wishlist count when an item is added', async () => {
    const user = userEvent.setup()
    render(
      <WishlistProvider>
        <ToggleHarness handle="daily-drift" />
        <AppBar />
      </WishlistProvider>,
    )

    const wishlist = screen.getByRole('link', { name: /wishlist/i })
    expect(within(wishlist).getByText('0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'toggle' }))

    expect(within(wishlist).getByText('1')).toBeInTheDocument()
  })

  it('opens the mobile search via the native details disclosure', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <WishlistProvider>
        <AppBar />
      </WishlistProvider>,
    )

    // 移动搜索与汉堡同款原生 <details>（零 JS 可用）；jsdom 30 原生切换
    // open 属性。桌面内联搜索框（aria-label Search products）常驻。
    const searchSummary = container.querySelector<HTMLElement>(
      'details summary[aria-label="Search"]',
    )
    expect(searchSummary).not.toBeNull()
    const searchDetails = searchSummary!.closest('details')
    expect(searchDetails).not.toHaveAttribute('open')

    await user.click(searchSummary!)
    expect(searchDetails).toHaveAttribute('open')

    const input = searchDetails!.querySelector('input[type="search"]') as HTMLInputElement
    expect(input).not.toBeNull()
    await user.type(input, 'running shoe')
    expect(input.value).toBe('running shoe')

    // 再点一次开关收起（原生 disclosure）
    await user.click(searchSummary!)
    expect(searchDetails).not.toHaveAttribute('open')
  })
})
