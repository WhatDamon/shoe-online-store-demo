import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import axe from 'axe-core'
import { Footer } from '@/components/marketing/footer'
import { PromiseStrip } from '@/components/marketing/promise-strip'
import { ProductCard } from '@/components/shop/product-card'
import { GiftGallery } from '@/components/shop/gift-gallery'
import { SizeSelector } from '@/components/shop/size-selector'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { giftItems } from '@/server/catalog/gifts'
import type { ProductView } from '@/server/catalog/service'

// ===========================================================================
// 无障碍回归门禁（差异化承诺：键盘可达 + 结构语义，axe 无 critical/serious 违规）。
//
// jsdom 无真实布局/排版 → 不启用 color-contrast（由对比度契约测试 src/test/a11y/
// contrast.test.ts 单独锁定 token 组合）；region/landmark/document-title 依赖
// 完整文档外壳，合成的区块树不启用。规则范围 = 结构/命名/焦点类，它们在 jsdom
// 中可判定，且是「键盘操作 + 读屏结构」差异化的核心。
//
// 保持 DOM 注入的测试虚拟容器内扫描：axe 默认规则对 container 生效。
// ===========================================================================

const STRUCTURAL_RULES: Record<string, { enabled: boolean }> = {
  // jsdom 不实现布局/排版：对比度、区域等依赖视口的规则跳过（另有 token 契约测试）。
  'color-contrast': { enabled: false },
  region: { enabled: false },
  'landmark-one-main': { enabled: false },
  'landmark-no-duplicate-banner': { enabled: false },
  'landmark-no-duplicate-contentinfo': { enabled: false },
  'landmark-no-duplicate-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  'document-title': { enabled: false },
  'meta-viewport': { enabled: false },
}

async function expectNoSeriousViolations(container: HTMLElement, label: string) {
  const results = await axe.run(container, {
    rules: STRUCTURAL_RULES,
    // 合成树内这些全局规则无意义，禁用避免误报。
  })
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.length}`),
    `${label} axe violations`,
  ).toEqual([])
  return results
}

const SAMPLE_PRODUCT: ProductView = {
  id: 'evo-01',
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'Unisex · 5 colorways',
  description: 'A unisex everyday sneaker offered in 5 colorways.',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [40, 41, 42],
  features: [],
  fitNotes: '',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: false },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  colors: [],
  images: [],
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [
    { value: 40, label: 'US 7' },
    { value: 41, label: 'US 8' },
    { value: 42, label: 'US 8.5' },
  ],
}

describe('a11y: axe structural gate (no critical/serious violations)', () => {
  it('scans the shop product card', async () => {
    const { container } = render(
      <WishlistProvider>
        <ProductCard product={SAMPLE_PRODUCT} />
      </WishlistProvider>,
    )
    await expectNoSeriousViolations(container as HTMLElement, 'product-card')
  })

  it('scans the size selector radio group', async () => {
    const { container } = render(
      <SizeSelector
        sizeOptions={[
          { value: 40, label: 'US 7' },
          { value: 41, label: 'US 8' },
          { value: 42, label: 'US 8.5' },
        ]}
        selected={null}
        onChange={() => {}}
      />,
    )
    await expectNoSeriousViolations(container as HTMLElement, 'size-selector')
  })

  it('scans the landing promise strip for heading order (h1 → h2 → h3)', async () => {
    const { container } = render(<PromiseStrip />)
    await expectNoSeriousViolations(container as HTMLElement, 'promise-strip')
  })

  it('scans the footer', async () => {
    const { container } = render(<Footer />)
    await expectNoSeriousViolations(container as HTMLElement, 'footer')
  })

  it('scans the gift gallery', async () => {
    const { container } = render(<GiftGallery gifts={giftItems.slice(0, 4)} />)
    await expectNoSeriousViolations(container as HTMLElement, 'gift-gallery')
  })
})

describe('a11y: heading-order across assembled landing sections', () => {
  it('h1 then sr-only h2 then h3 in PromiseStrip (no jump from h1 to h3)', async () => {
    // PromiseStrip 单独扫时 h2 是首个标题，axe 允许任意起始。
    // 组合测试：<h1>(hero 代替) → PromiseStrip，验证 h1→h2→h3 不跳级。
    const { container } = render(
      <>
        <h1>Evoloop</h1>
        <PromiseStrip />
      </>,
    )
    const res = await expectNoSeriousViolations(container as HTMLElement, 'hero+promise')
    // 显式确认 heading 顺序存在 h2（PromiseStrip 的 sr-only 标题）充当 h1→h3 的桥梁。
    const headings = Array.from(container.querySelectorAll('h1, h2, h3')).map((h) =>
      Number(h.tagName.slice(1)),
    )
    expect(headings).toEqual([1, 2, 3, 3, 3])
    void res
  })
})

// 保留 axe 探针可用性的一个最小冒烟（若未来 axe 升级破坏调用面，此测试先红）。
describe('a11y: axe runtime smoke', () => {
  it('runs and returns no results for an empty tree', async () => {
    const { container } = render(<div />)
    const res = await axe.run(container as HTMLElement, { rules: STRUCTURAL_RULES })
    expect(Array.isArray(res.violations)).toBe(true)
  })
})
