'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { site } from '@/lib/site'

// Landing hero lifestyle 图（远程精选 + ink 底色静默兜底：图片失效即降级为深色面板，
// 文案始终保持白色高对比）。加载失败仅在客户端触发，SSR 恒为白色文字，无 mismatch。
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=2200&q=80'

export function Hero() {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <section className="relative flex min-h-dvh items-end overflow-hidden bg-ink">
      {imageFailed ? null : (
        <Image
          src={HERO_IMAGE}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-55"
          onError={() => setImageFailed(true)}
        />
      )}
      {/* 顶部较深，保证透明 AppBar 上的白色文字可读 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/10 to-ink/50"
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 pb-28 pt-40">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-white/80">
          {site.hero.kicker}
        </p>
        <h1 className="mt-4 max-w-4xl font-heading text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
          {site.tagline}
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-7 text-white/75">{site.hero.title}</p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/shop"
            className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-[15px] font-medium text-ink transition-colors hover:bg-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {site.hero.cta}
          </Link>
          <Link
            href="#collections"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-2 text-[15px] font-medium text-white transition-opacity hover:opacity-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Explore the series
          </Link>
        </div>
      </div>

      <a
        href="#collections"
        aria-label="Scroll to collections"
        className="absolute inset-x-0 bottom-5 flex justify-center text-white/60 transition-colors hover:text-white"
      >
        <ArrowDownIcon className="size-5 animate-bounce" />
      </a>
    </section>
  )
}
