import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppBar } from './app-bar'
import { useWishlist, WishlistProvider } from '@/components/shop/wishlist-provider'

/**
 * 愿望单计数的文案是**组合**出来的，不是一条词典条目：`app-bar.tsx` 把
 * `marketing.appBar.wishlist` 与 `wishlistItem` / `wishlistItems` 二选一拼成
 * `Wishlist, N item(s)`，落点是愿望单链接的 `aria-label`——它是**属性**，不在可见文本里，
 * 查 `textContent` 看不见它。拼装没有类型约束：单复数判断写反、或把三个键的取用顺序
 * 接错，其它测试都不会红，故在此把渲染结果钉死（判别力经负向对照验证）。
 */
function SaveHandleButton({ handle }: { handle: string }) {
  const { toggle } = useWishlist()
  return (
    <button type="button" onClick={() => toggle(handle)}>
      save
    </button>
  )
}

describe('AppBar 愿望单计数文案的拼装', () => {
  it('0 件时链接的可及名是 Wishlist, 0 items', () => {
    render(
      <WishlistProvider>
        <AppBar />
      </WishlistProvider>,
    )

    const wishlist = screen.getByRole('link', { name: 'Wishlist, 0 items' })
    expect(wishlist).toHaveAttribute('aria-label', 'Wishlist, 0 items')
  })

  it('1 件时链接的可及名是 Wishlist, 1 item（单数形）', async () => {
    const user = userEvent.setup()
    render(
      <WishlistProvider>
        <SaveHandleButton handle="daily-drift" />
        <AppBar />
      </WishlistProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'save' }))

    const wishlist = screen.getByRole('link', { name: 'Wishlist, 1 item' })
    expect(wishlist).toHaveAttribute('aria-label', 'Wishlist, 1 item')
  })
})
