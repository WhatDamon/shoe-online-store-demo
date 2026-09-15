// 愿望单心形图标：同一 path 曾在本文件、saved-pairs 与 product-result-card 各抄一份。
// filled 控制实心/描边（active 与 saved 两种语义用的是同一视觉）。
export function WishlistHeart({
  size = 20,
  filled,
  className,
}: {
  size?: number
  filled: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M12 20.6 4.9 13.7a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.6.6.6-.6a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5L12 20.6Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
