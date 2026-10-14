import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { ProductResultCard } from '@/components/assistant/product-result-card'
import { messages } from '@/i18n/messages'
import type { Locale } from '@/i18n/locales'
import type { ProductView } from '@/domain/product'
import type { ProductCard as CardEvent } from '@/domain/chat-events'
import type { CatalogSummary } from '@/app/api/catalog/route'
import { ProductCard } from './product-card'
import { ProductGallery } from './product-gallery'
import { SavedPairs } from './saved-pairs'
import { WishlistProvider } from './wishlist-provider'

/**
 * `ProductVisual` 的 SVG 可及名（`{商品名} — printed shoe`）也是**界面文案**，但它的 `locale`
 * 是**可选** prop（同一个组件既被 RSC 也被 client 组件渲染，取不到 Provider 时要有缺省，裁定 R4）。
 * 可选 prop 的缺省值让「调用点忘了传」静默取默认语言——与 `formatPrice` 阶段 1 的洞同一类，
 * 只是这里的后果在可及名上（读屏用户听到的语言与页面语言不一致）。
 *
 * 本文件把 4 个客户端调用点的接线钉住：在 `LocaleProvider locale="zh-CN"` 下渲染，可及名必须是
 * 中文后缀（字面量，不走词典取值——词典被改就红）。某个调用点退回不传 `locale` 时，这里变红。
 *
 * 受保护的 `product-visual.test.tsx` / `product-result-card.test.tsx` 不挂 Provider，走默认语言：
 * 接线后它们必须仍全绿且不改动，那是「英文输出不回归」的另一半证据。
 */

const EN_SUFFIX = '— printed shoe'
const ZH_SUFFIX = '— 3D 打印鞋'

const product: ProductView = {
  id: 'p01',
  handle: 'daily-drift',
  title: 'Daily Drift',
  subtitle: 'Everyday knit-lattice sneaker',
  description: 'x',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [42],
  features: [],
  fitNotes: '',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [{ value: 42, label: 'US 8.5' }],
}

const cardEvent: CardEvent = {
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'Unisex · 5 colorways',
  image: null,
  imageKind: 'svg',
  photoCount: 0,
  sizeRange: 'US 4.5–9.5',
  colorCount: 5,
  palette: ['#111111', '#0f766e'],
}

/** `/api/catalog` 的摘要行：`image: null` 才能走到 `SavedPairs` 的 SVG 兜底分支。 */
const savedRow: CatalogSummary = {
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'Unisex · 5 colorways',
  image: null,
  colorCount: 5,
  photoCount: 0,
  sizeRange: 'US 4.5–9.5',
  storeAvailable: false,
}

const withLocale = (locale: Locale, node: ReactNode) =>
  render(
    <LocaleProvider locale={locale} messages={messages(locale)}>
      {node}
    </LocaleProvider>,
  )

const visualLabels = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('svg[data-product-visual]')).map((svg) =>
    svg.getAttribute('aria-label'),
  )

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('无图商品视觉的可及名随界面语言', () => {
  it('ProductCard 在 zh-CN 下是中文后缀', () => {
    const { container } = withLocale('zh-CN', <ProductCard product={product} />)
    expect(visualLabels(container)).toEqual([`Daily Drift ${ZH_SUFFIX}`])
  })

  it('同一张卡在 en 下仍是英文后缀（接线不改变英文输出）', () => {
    const { container } = withLocale('en', <ProductCard product={product} />)
    expect(visualLabels(container)).toEqual([`Daily Drift ${EN_SUFFIX}`])
  })

  it('ProductGallery 的主图与 3 个视图缩略图都是中文后缀', () => {
    const { container } = withLocale('zh-CN', <ProductGallery product={product} />)
    const labels = visualLabels(container)
    expect(labels).toHaveLength(4) // 主图 + side/sole/detail 三张缩略图
    for (const label of labels) expect(label).toBe(`Daily Drift ${ZH_SUFFIX}`)
  })

  it('ProductResultCard 在 zh-CN 下是中文后缀', () => {
    const { container } = withLocale('zh-CN', <ProductResultCard item={cardEvent} />)
    expect(visualLabels(container)).toEqual([`Urban Bloom ${ZH_SUFFIX}`])
  })

  it('SavedPairs 的无图收藏行在 zh-CN 下是中文后缀', async () => {
    window.localStorage.setItem('evoloop:wishlist', JSON.stringify(['dc-1001']))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([savedRow]),
      }),
    )
    const { container } = withLocale(
      'zh-CN',
      <WishlistProvider>
        <SavedPairs />
      </WishlistProvider>,
    )
    await screen.findByText('Urban Bloom')
    expect(visualLabels(container)).toEqual([`Urban Bloom ${ZH_SUFFIX}`])
  })
})
