'use client'

import { useWishlist } from './wishlist-provider'
import { WishlistHeart } from './wishlist-icon'

export function WishlistButton({ handle }: { handle: string }) {
  const { items, toggle } = useWishlist()
  const active = items.includes(handle)

  return (
    <button
      type="button"
      onClick={() => toggle(handle)}
      aria-pressed={active}
      aria-label={active ? 'Remove from wishlist' : 'Add to wishlist'}
      className="inline-flex items-center justify-center rounded-full p-2 text-neutral-600 transition-colors hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
    >
      <WishlistHeart
        size={20}
        filled={active}
        className={active ? 'text-neutral-900' : undefined}
      />
    </button>
  )
}
