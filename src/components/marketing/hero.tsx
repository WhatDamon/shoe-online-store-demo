import Link from 'next/link'
import { ArrowDownIcon } from 'lucide-react'
import { site } from '@/lib/site'
import { HeroBackground } from './hero-background'

// Landing hero：HeroBackground 客户端组件负责背景轮播（静态图 6s → 视频已缓存则交叉淡化播放 → 淡回静态图，循环）
// 文字/CTA/遮罩保持 RSC；深底 + 渐变遮罩保证白字高对比

export function Hero() {
  return (
    <section className="relative flex min-h-dvh items-end overflow-hidden bg-[#111111]">
      <HeroBackground />
      {/* 顶部较深，保证透明 AppBar 上的白色文字可读 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#111111]/70 via-[#111111]/10 to-[#111111]/50"
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
            className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-[15px] font-medium text-[#111111] transition-colors hover:bg-[#e5e5e5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
