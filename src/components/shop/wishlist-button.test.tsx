import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WishlistButton } from './wishlist-button'
import { WishlistProvider } from './wishlist-provider'

describe('WishlistButton', () => {
  it('toggles aria-pressed and persists', async () => {
    const user = userEvent.setup()
    render(
      <WishlistProvider>
        <WishlistButton handle="daily-drift" />
      </WishlistProvider>,
    )
    const btn = screen.getByRole('button', { name: /add to wishlist/i })
    await user.click(btn)
    expect(screen.getByRole('button', { name: /remove from wishlist/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(JSON.parse(window.localStorage.getItem('evoloop:wishlist') ?? '[]')).toEqual([
      'daily-drift',
    ])
  })
})
