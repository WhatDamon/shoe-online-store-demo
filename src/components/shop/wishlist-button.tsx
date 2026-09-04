'use client'

import { useWishlist } from './wishlist-provider'

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
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        focusable="false"
        className={active ? 'text-neutral-900' : undefined}
      >
        <path
          d="M12 20.6 4.9 13.7a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.6.6.6-.6a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5L12 20.6Z"
          fill={active ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
