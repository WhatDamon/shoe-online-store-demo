import { pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'
import type { Metadata } from 'next'
import { SavedPairs } from '@/components/shop/saved-pairs'

// /saved：愿望单清单页（决策：AI Save pair / PDP 心形共用同一 localStorage 单源）。
// RSC 壳只做 metadata + 头部；数据完全来自客户端 wishlist 快照 → 经只读
// /api/catalog 拉摘要（DB/seed 在 server，客户端无目录副本）。收藏为空时
// SavedPairs 自渲染空态（含去 /shop 逛的 CTA）。
export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  return pageMetadata(locale, {
    title: t['shop.saved.title'],
    description: t['shop.saved.metaDescription'],
    path: '/saved',
    robots: { index: false, follow: false },
  })
}

export default async function SavedPage(props: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          {t['shop.saved.title']}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t['shop.saved.subtitle']}</p>
      </header>
      <SavedPairs />
    </div>
  )
}
