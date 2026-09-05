'use client'

import Link from 'next/link'
import { formatPrice } from '@/lib/format'
import { ProductVisual } from '@/components/shop/product-visual'
import type { ProductCard as ProductCardEvent } from '@/server/ai/events'

// 会话内商品结果卡：ProductCard 的简版（小图/名/价 → 点击进详情）。
// 事件只携带展示必需量（handle/title/price/palette，规格 §8.4），本地生成图为
// 起提示作用的缩略预览——精确渲染以详情页为准。
export function ProductResultCard({ item }: { item: ProductCardEvent }) {
  const href = `/product/${item.handle}`
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-surface p-2 transition-colors hover:border-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
    >
      <span className="block h-12 w-[4.5rem] shrink-0 overflow-hidden rounded-md bg-[#f3f1ea]">
        <ProductVisual
          name={item.title}
          view="side"
          className="h-full w-full"
          visual={{ palette: item.palette, accent: item.palette[1], views: 3 }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-900">{item.title}</span>
        <span className="block text-[13px] text-neutral-500">{formatPrice(item.price)}</span>
      </span>
    </Link>
  )
}
