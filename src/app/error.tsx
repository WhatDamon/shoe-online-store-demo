'use client'

import Link from 'next/link'
import { site } from '@/lib/site'
import { SiteShell } from '@/components/marketing/site-shell'

// 错误壳（克制消费者文案 + 重试）：'use client' 以支持 reset()。
// 根 error 边界在根布局下替换整个 children（组布局的壳被绕过），故自带全局壳。
export default function Error({ reset }: { reset: () => void }) {
  return (
    <SiteShell>
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-24 text-center text-ink">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-brand">
          {site.name}
        </p>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Something went wrong on our end
        </h1>
        <p className="mt-3 max-w-md text-neutral-600">
          Please give it one more try — most hiccups clear right up.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-full bg-ink px-7 py-3 text-sm font-medium text-canvas transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            Try again
          </button>
          <Link
            href="/shop"
            className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-7 py-3 text-sm font-medium text-ink transition-colors hover:border-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            Browse the shop
          </Link>
        </div>
      </div>
    </SiteShell>
  )
}
