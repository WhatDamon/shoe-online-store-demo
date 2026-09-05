'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ProductVisual } from '@/components/shop/product-visual'
import type { ProductCard as ProductCardEvent } from '@/server/ai/events'

// 会话内商品结果卡：展示真实首图 + 真实元数据（货号/码段/色卡数/照片数），
// 一律不带价格——价格只在详情页/店铺出现（AI 不传播 demo 价段）。
// 无照片的产品（目前目录无此情形）→ 以 ProductVisual 真实色卡 SVG 兜底。
const metaOf = (item: ProductCardEvent): string | null => {
  const parts: string[] = []
  if (item.sizeRange) parts.push(item.sizeRange)
  if (item.colorCount > 0) parts.push(`${item.colorCount} color${item.colorCount === 1 ? '' : 's'}`)
  if (item.photoCount > 1) parts.push(`${item.photoCount} photos`)
  return parts.length ? parts.join(' · ') : null
}

export function ProductResultCard({ item }: { item: ProductCardEvent }) {
  const href = `/product/${item.handle}`
  const meta = metaOf(item)
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-surface p-2 transition-colors hover:border-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
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
              className="h-full w-full"
              visual={{ palette: item.palette, accent: item.palette[1], views: 3 }}
            />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-900">{item.title}</span>
        {item.subtitle ? (
          <span className="block truncate text-[12px] leading-4 text-neutral-500">
            {item.subtitle}
          </span>
        ) : null}
        {meta ? (
          <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">{meta}</span>
        ) : null}
      </span>
    </Link>
  )
}
