import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SiteShell } from './site-shell'
import { WishlistProvider } from '@/components/shop/wishlist-provider'

// 全局壳组合：AppBar（banner + 导航）与 Footer 恒在，内容进 main；
// tone 只改头部初始底色类，不影响结构。
describe('SiteShell', () => {
  it('renders app bar, children in main, and footer for solid tone', () => {
    render(
      <WishlistProvider>
        <SiteShell>
          <h1>Page content</h1>
        </SiteShell>
      </WishlistProvider>,
    )

    // AppBar banner 存在于 main 之外（全站头）
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Evoloop' })).toHaveAttribute('href', '/')

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { name: 'Page content' })).toBeInTheDocument()
    expect(main).not.toContainElement(screen.getByRole('banner'))

    // Footer 底部导航
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/shop')
    // 核心 Slogan 收尾（品牌声明全站可见）
    expect(
      within(footer).getByText('3D Printed. Closed-Loop. A New Footwear Phenomenon.'),
    ).toBeInTheDocument()
    // 项目性质声明：学生黑客松作品、非商业服务（页脚全站一行）
    expect(
      within(footer).getByText(
        'Born at a student hackathon. Built since as an independent project.',
      ),
    ).toBeInTheDocument()
  })

  it('keeps the same structure for the overlay tone (landing)', () => {
    render(
      <WishlistProvider>
        <SiteShell tone="overlay">
          <p>Hero content</p>
        </SiteShell>
      </WishlistProvider>,
    )

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('Hero content')
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })
})
