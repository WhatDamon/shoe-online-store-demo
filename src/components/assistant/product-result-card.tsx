'use client'

import Image from 'next/image'
import { LocaleLink } from '@/components/i18n/locale-link'
import { useLocale, useMessages } from '@/components/i18n/locale-provider'
import { ProductVisual } from '@/components/shop/product-visual'
import { useOptionalWishlist } from '@/components/shop/wishlist-provider'
import { WishlistHeart } from '@/components/shop/wishlist-icon'
import type { Messages } from '@/i18n/messages'
import type { ProductCard as ProductCardEvent } from '@/domain/chat-events'

// 会话内商品结果卡：展示真实首图 + 真实元数据（货号/码段/色卡数/照片数），
// 一律不带价格——价格只在详情页/店铺出现（AI 不传播 demo 价段）。
// 无照片的产品（目前目录无此情形）→ 以 ProductVisual 真实色卡 SVG 兜底。
//
// 收藏（Save pair）：心形是容器的绝对定位 sibling，绝不嵌套进主区 <LocaleLink>
// （interactive-inside-interactive 反模式）；Provider 缺席（孤立渲染/测试）时不渲染。
// 量词取自词典（数字来自事件）；`·` 是元数据分隔符，不是句子。
const metaOf = (item: ProductCardEvent, t: Messages): string | null => {
  const parts: string[] = []
  if (item.sizeRange) parts.push(item.sizeRange)
  if (item.colorCount > 0)
    parts.push(
      `${item.colorCount} ${t[item.colorCount === 1 ? 'assistant.card.color' : 'assistant.card.colors']}`,
    )
  if (item.photoCount > 1) parts.push(`${item.photoCount} ${t['assistant.card.photos']}`)
  return parts.length ? parts.join(' · ') : null
}

export function ProductResultCard({ item }: { item: ProductCardEvent }) {
  const t = useMessages()
  // 无图结果卡回落到 SVG 色卡：可及名（`— printed shoe`）随界面语言，必须显式传 locale。
  const locale = useLocale()
  const href = `/product/${item.handle}`
  const meta = metaOf(item, t)
  const wishlist = useOptionalWishlist()
  const saved = wishlist?.items.includes(item.handle) ?? false
  const toggleSave = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    wishlist?.toggle(item.handle)
  }

  return (
    <div className="relative rounded-xl border border-neutral-200 bg-surface transition-colors hover:border-neutral-400">
      <LocaleLink
        href={href}
        className="flex items-center gap-3 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
      >
        {/* 真实照片（整图居中、白色底、不裁切）；无图才用色卡 SVG */}
        <span className="relative block h-12 w-16 shrink-0 overflow-hidden rounded-md bg-white">
          {item.imageKind === 'photo' && item.image ? (
            <Image src={item.image} alt="" fill sizes="4rem" className="object-contain" />
          ) : (
            <span className="absolute inset-0">
              <ProductVisual
                name={item.title}
                view="side"
                locale={locale}
                className="h-full w-full"
                visual={{ palette: item.palette, accent: item.palette[1], views: 3 }}
              />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1 pr-6">
          <span className="block truncate text-sm font-medium text-neutral-900">{item.title}</span>
          {item.subtitle ? (
            <span className="block truncate text-[12px] leading-4 text-neutral-500">
              {item.subtitle}
            </span>
          ) : null}
          {meta ? (
            <span className="mt-0.5 block text-[11px] leading-4 text-neutral-500">{meta}</span>
          ) : null}
        </span>
      </LocaleLink>

      {wishlist ? (
        <button
          type="button"
          onClick={toggleSave}
          aria-pressed={saved}
          aria-label={saved ? t['shop.wishlist.remove'] : t['shop.wishlist.add']}
          className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
        >
          <WishlistHeart
            size={16}
            filled={saved}
            className={saved ? 'text-neutral-900' : undefined}
          />
        </button>
      ) : null}
    </div>
  )
}
