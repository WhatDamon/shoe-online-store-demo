import Link from 'next/link'
import { site } from '@/lib/site'
import { SiteShell } from '@/components/marketing/site-shell'

// 消费者语气（克制，无技术措辞）：未知页面/未知商品 handle → 404。
// 未知路径在根布局下渲染（无组布局），故自带全局壳保证导航/Footer 一致。
export default function NotFound() {
  return (
    <SiteShell>
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-24 text-center text-ink">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-brand">{site.name}</p>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-3 max-w-md text-neutral-600">
          It may have moved, or the link may be out of date. The shop is still open, though.
        </p>
        <Link
          href="/shop"
          className="mt-8 inline-flex items-center justify-center rounded-full bg-ink px-7 py-3 text-sm font-medium text-canvas transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
        >
          Browse the shop
        </Link>
      </div>
    </SiteShell>
  )
}
