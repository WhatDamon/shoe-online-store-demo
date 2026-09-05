'use client'

import Image from 'next/image'
import Link from 'next/link'
import { formatPrice } from '@/lib/format'
import { sizeRangeLabel } from '@/lib/size-range'
import type { ProductView } from '@/server/catalog/service'
import { ProductVisual } from './product-visual'
import { WishlistButton } from './wishlist-button'
import { useOptionalWishlist } from './wishlist-provider'

export function ProductCard({ product }: { product: ProductView }) {
  const href = `/product/${product.handle}`
  const sizeHint = sizeRangeLabel(product.sizeOptions)
  // Provider 存在时才渲染收藏角标：收藏功能依赖上下文，缺失（如 SSR 首帧/孤立渲染）
  // 时静默隐藏而不是让 useWishlist 抛错。
  const hasWishlist = useOptionalWishlist() !== null
  const cover = product.images?.[0]

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-surface transition-shadow hover:shadow-md">
      <Link
        href={href}
        className="flex h-full flex-col focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
      >
        <div className="relative overflow-hidden bg-[#f3f1ea]">
          {cover ? (
            // 真实商品照（决策 #16）：首图作封面；无图产品回落到 SVG 3D 视觉
            <div className="relative aspect-square w-full">
              <Image
                src={cover}
                alt={product.title}
                fill
                sizes="(max-width:640px) 100vw, (max-width:1024px) 50vw, 25vw"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </div>
          ) : (
            <ProductVisual
              visual={product.visual}
              name={product.title}
              construction={product.construction}
              view="side"
              className="aspect-square w-full"
            />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-3">
          <h3 className="text-[15px] font-medium leading-snug text-neutral-900">{product.title}</h3>
          {product.subtitle ? (
            <p className="text-[13px] leading-snug text-neutral-500">{product.subtitle}</p>
          ) : null}
          <div className="mt-auto flex items-baseline justify-between gap-2 pt-2">
            <p className="text-[15px] font-semibold text-neutral-900">
              {formatPrice(product.price.amount)}
            </p>
            {sizeHint ? <p className="text-xs text-neutral-400">{sizeHint}</p> : null}
          </div>
        </div>
      </Link>
      {hasWishlist ? (
        <div className="absolute right-2.5 top-2.5 z-10 rounded-full bg-surface/90 backdrop-blur-sm">
          {/* 角落按钮是 Link 的兄弟节点（非后代）：点击它不会触发卡片导航 */}
          <WishlistButton handle={product.handle} />
        </div>
      ) : null}
    </article>
  )
}
