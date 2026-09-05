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

  it('opens a mobile search row with an input and closes it via Escape', async () => {
    const user = userEvent.setup()
    render(
      <WishlistProvider>
        <AppBar />
      </WishlistProvider>,
    )

    // 初始：展开按钮就绪（aria-expanded=false）；只有桌面内联搜索输入框
    // （type=search → searchbox 角色）。
    const openBtn = screen.getByRole('button', {
      name: 'Search',
      expanded: false,
    })
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
      </WishlistProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Search', expanded: false }))
    expect(screen.getAllByRole('searchbox', { name: 'Search products' })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Close search' }))
    expect(screen.getAllByRole('searchbox', { name: 'Search products' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-expanded', 'false')
  })
})
