import { catalog } from '@/server/catalog/adapter'
import type { Metadata } from 'next'
import { availableSizesForSystem } from '@/domain/size'
import { listProductsForMarket } from '@/server/catalog/service'
import { giftItems } from '@/server/catalog/gifts'
import { GIFT_OFFER } from '@/lib/gift-offer'
import { market } from '@/lib/market'
import { parseShopParams } from '@/lib/shop-search-params'
import { ProductFilterBar } from '@/components/shop/product-filter-bar'
import { ProductGrid } from '@/components/shop/product-grid'
import { GiftGallery } from '@/components/shop/gift-gallery'
import { EmptyState } from './empty-state'
import { pageMetadata } from '@/lib/seo'
import { JsonLd } from '@/components/seo/json-ld'
import { itemListSchema, webPageSchema } from '@/lib/structured-data'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

export const dynamic = 'force-dynamic'

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  return pageMetadata(locale, {
    // 页面名与导航里的 `Shop` 是同一个表面名，故共用 `nav.shop`（同值同语境，不另建键）。
    title: t['nav.shop'],
    description: t['shop.meta.description'],
    path: '/shop',
  })
}

type ShopSearchParams = { [key: string]: string | string[] | undefined }

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<ShopSearchParams>
}) {
  const { locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const t = messages(locale)
  const raw = (await searchParams) ?? {}
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((v) => sp.append(key, v))
    else sp.append(key, value)
  }
  const filter = parseShopParams(sp)

  const [products, allCollections] = await Promise.all([
    listProductsForMarket(filter),
    catalog().getCollections(),
  ])
  const collectionOptions = allCollections.map((c) => ({
    value: c.handle,
    label: c.name,
  }))
  const sizeOptions = availableSizesForSystem(market.sizeSystem)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10">
      <JsonLd
        data={webPageSchema(locale, {
          name: t['shop.schema.name'],
          description: t['shop.schema.description'],
          path: '/shop',
          type: 'CollectionPage',
        })}
      />
      <JsonLd data={itemListSchema(locale, products)} />
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">{t['nav.shop']}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t['shop.subtitle']}</p>
      </header>

      {/* 赠品活动条：满 $50 赠一；软文案呈现。门槛/赠品名/材质来自 gift-offer 单源。 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-surface px-4 py-3">
        <p className="text-sm text-neutral-700">
          <span className="font-medium text-ink">
            {t['shop.gift.bannerLead']}
            {GIFT_OFFER.thresholdUsd}
            {t['shop.gift.bannerTail']}
          </span>{' '}
          <span className="text-neutral-500">
            {giftItems.length} {GIFT_OFFER.plural} {t['shop.gift.chooseLead']} {GIFT_OFFER.material}
            .
          </span>
        </p>
        <a
          href="#free-gifts"
          className="text-sm font-medium text-brand underline-offset-4 transition-colors hover:underline"
        >
          {t['shop.gift.seeGifts']}
        </a>
      </div>

      <ProductFilterBar
        initial={filter}
        collectionOptions={collectionOptions}
        sizeOptions={sizeOptions}
      />

      <p role="status" className="mt-6 text-sm text-neutral-500">
        {products.length}{' '}
        {products.length === 1 ? t['shop.styleCount.one'] : t['shop.styleCount.many']}
      </p>

      {products.length > 0 ? (
        <div className="mt-4">
          {/* 结果区分区标题（读屏）：商品卡 h3 需要一个 h2 祖先，避免 h1 → h3 跳级。 */}
          <h2 className="sr-only">{t['shop.allStyles']}</h2>
          <ProductGrid products={products} />
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState locale={locale} />
        </div>
      )}

      <GiftGallery gifts={giftItems} />
    </div>
  )
}
