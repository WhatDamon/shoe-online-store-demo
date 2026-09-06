import { pageMetadata } from '@/lib/seo'
import type { Metadata } from 'next'
import { SavedPairs } from '@/components/shop/saved-pairs'

// /saved：愿望单清单页（决策：AI Save pair / PDP 心形共用同一 localStorage 单源）。
// RSC 壳只做 metadata + 头部；数据完全来自客户端 wishlist 快照 → 经只读
// /api/catalog 拉摘要（DB/seed 在 server，客户端无目录副本）。收藏为空时
// SavedPairs 自渲染空态（含去 /shop 逛的 CTA）。
export const metadata: Metadata = pageMetadata({
  title: 'Saved pairs',
  description: 'Your saved pairs — pick up where you left off.',
})

export default function SavedPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Saved pairs</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Pairs you marked while browsing or in the assistant — saved on this device.
        </p>
      </header>
      <SavedPairs />
    </div>
  )
}
