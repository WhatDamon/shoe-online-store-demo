'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import type { GiftItem } from '@/server/catalog/gifts'

// 赠品画廊（决策 #16）：满 $50 赠一的边角料小件 —— 仅展示（不售卖、无 PDP）。
// 点击任一小件打开灯箱轮播该件全部图片；Esc/背景/关闭按钮退出。
export function GiftGallery({ gifts }: { gifts: GiftItem[] }) {
  const [active, setActive] = useState<{ gift: GiftItem; idx: number } | null>(null)

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null)
      if (e.key === 'ArrowRight') {
        setActive((a) => a && { ...a, idx: (a.idx + 1) % a.gift.images.length })
      }
      if (e.key === 'ArrowLeft') {
        setActive((a) =>
          a ? { ...a, idx: (a.idx - 1 + a.gift.images.length) % a.gift.images.length } : null,
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  return (
    <section
      aria-labelledby="free-gifts-heading"
      id="free-gifts"
      className="mt-16 scroll-mt-24 border-t border-neutral-200 pt-10"
    >
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">Free gifts</p>
      <h2
        id="free-gifts-heading"
        className="mt-2 font-heading text-2xl font-semibold tracking-tight text-ink"
      >
        With any order over $50
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
        Pick one of these little buddies — pressed from leftover upper offcuts, so nothing goes to
        waste. Just add one when you check out.
      </p>

      <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {gifts.map((gift) => (
          <li key={gift.handle}>
            <button
              type="button"
              onClick={() => setActive({ gift, idx: 0 })}
              aria-label={`View ${gift.title} photos`}
              className="group flex w-full flex-col rounded-2xl border border-neutral-200 bg-surface text-left transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
            >
              <span className="relative aspect-square w-full overflow-hidden rounded-t-2xl bg-[#f3f1ea]">
                <Image
                  src={gift.images[0]}
                  alt=""
                  fill
                  sizes="(min-width:1024px) 20vw, (min-width:640px) 33vw, 50vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </span>
              <span className="flex flex-col gap-1 p-3">
                <span className="text-sm font-medium text-neutral-900">{gift.title}</span>
                <span className="text-xs text-neutral-500">
                  {gift.images.length > 1 ? `${gift.images.length} photos · ` : ''}
                  {gift.colors.slice(0, 2).join(' / ')}
                  {gift.colors.length > 2 ? ' / …' : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${active.gift.title} photos`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActive(null)}
              aria-label="Close gallery"
              className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <XIcon aria-hidden="true" className="size-4" />
            </button>
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#f3f1ea]">
              <Image
                src={active.gift.images[active.idx]}
                alt={`${active.gift.title} photo ${active.idx + 1}`}
                fill
                sizes="(min-width:640px) 672px, 100vw"
                className="object-cover"
              />
            </div>
            <p className="px-2 pb-2 pt-3 text-center text-sm font-medium text-neutral-900">
              {active.gift.title}
              {active.gift.images.length > 1
                ? ` — ${active.idx + 1}/${active.gift.images.length}`
                : ''}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
