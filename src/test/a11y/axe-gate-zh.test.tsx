import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import axe from 'axe-core'
import { AppBar } from '@/components/marketing/app-bar'
import { Footer } from '@/components/marketing/footer'
import { PromiseStrip } from '@/components/marketing/promise-strip'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { GiftGallery } from '@/components/shop/gift-gallery'
import { ProductCard } from '@/components/shop/product-card'
import { SizeSelector } from '@/components/shop/size-selector'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { messages } from '@/i18n/messages'
import { giftItems } from '@/server/catalog/gifts'
import type { ProductView } from '@/domain/product'

// ===========================================================================
// 逐语言无障碍回归门禁：把 `axe-gate.test.tsx` 的同一组组件在 `zh-CN` 下重跑，
// 并断言组装后的 heading 序仍是 [1,2,3,3,3]（与默认语言那份逐字相同）。
//
// **为什么必须新增 AppBar 到扫描面（本文件存在的核心理由）**：`axe-gate.test.tsx`
// 的组件集是商品卡 / landing 段落 / `Footer`，**不含 AppBar**——而语言切换器
//（`role="group"` + `aria-label` + `aria-current`）只住在 AppBar 里，且**同一功能有两个
// 实例**（移动菜单内 `<md`、右侧操作区 `≥md`，两者在 jsdom 里同时存在于 DOM）。
// 也就是说，这颗新增的可及名/状态控件此前不在任何 axe 扫描面内：aria-label 漏写、
// `role="group"` 误写成 landmark、两个实例的可及名重复，都不会让任何测试变红。
// 这里把 AppBar 挂进 zh 组件集，让切换器的可及名与 aria-current 进入扫描面。
//
// 与默认语言那份保持同一做法：同一份规则禁用清单（jsdom 无布局/文档外壳）、
// 同一套 critical/serious 判定、同一组组件。差异只有两条：
//   1. 语言上下文是 zh-CN（`LocaleProvider` + `messages('zh-CN')`）；
//   2. 多了 AppBar 这一组扫描。
//
// `PromiseStrip` 是服务端组件、**不读 Provider**，只接受 `locale` prop，故这里显式传
// `locale="zh-CN"` 才能真的渲染中文（与生产渲染点 `[locale]/page.tsx` 同一手法）。
// ===========================================================================

const STRUCTURAL_RULES: Record<string, { enabled: boolean }> = {
  // 与 axe-gate.test.tsx 完全一致：jsdom 不实现布局/排版，对比度、区域等依赖视口的规则
  // 跳过（对比度另有 token 契约测试 src/test/a11y/contrast.test.ts）。
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

// 语言切换器读 `usePathname()`；本文件只渲染 AppBar（App Router 之外），故与
// `language-switcher.test.tsx` 同一手法显式控制 pathname。
const nav = vi.hoisted(() => ({ pathname: '/zh-CN/shop' }) as { pathname: string | null })
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

const ZH = messages('zh-CN')

/** 客户端组件的语言上下文：`locale` 决定 `useLocale()`（链接前缀、aria-current），词典决定文案。 */
function inZh(children: ReactNode) {
  return (
    <LocaleProvider locale="zh-CN" messages={ZH}>
      {children}
    </LocaleProvider>
  )
}

async function expectNoViolations(container: HTMLElement, label: string) {
  const results = await axe.run(container, { rules: STRUCTURAL_RULES })
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.length}`),
    `${label} axe violations`,
  ).toEqual([])
  // 比默认语言那份更严的一步：zh 语境下断言**零违规**（不止 critical/serious）。
  // 新增的 AppBar 扫描面若出现 moderate/minor 也在这里暴露，而不是等下一次人工审计。
  expect(
    results.violations.map((v) => `${v.id} (${v.impact ?? 'unknown'}): ${v.nodes.length}`),
    `${label} axe violations (all impacts)`,
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

describe('a11y: axe structural gate under zh-CN (no violations)', () => {
  it('scans the shop product card', async () => {
    const { container } = render(
      inZh(
        <WishlistProvider>
          <ProductCard product={SAMPLE_PRODUCT} />
        </WishlistProvider>,
      ),
    )
    await expectNoViolations(container as HTMLElement, 'product-card@zh-CN')
  })

  it('scans the size selector radio group', async () => {
    const { container } = render(
      inZh(
        <SizeSelector
          // 尺码标签与默认语言那份逐字相同：**语言与市场解耦**（ADR 0008 决策 6）——
          // 中文界面显示 US 尺码与 USD 价格是刻意的结果，不因 locale 改变展示契约。
          sizeOptions={[
            { value: 40, label: 'US 7' },
            { value: 41, label: 'US 8' },
            { value: 42, label: 'US 8.5' },
          ]}
          selected={null}
          onChange={() => {}}
        />,
      ),
    )
    await expectNoViolations(container as HTMLElement, 'size-selector@zh-CN')
  })

  it('scans the landing promise strip for heading order (h1 → h2 → h3)', async () => {
    // PromiseStrip 不读 Provider（服务端组件）：语言必须由 prop 传入。
    const { container } = render(inZh(<PromiseStrip locale="zh-CN" />))
    await expectNoViolations(container as HTMLElement, 'promise-strip@zh-CN')
  })

  it('scans the footer', async () => {
    const { container } = render(inZh(<Footer />))
    await expectNoViolations(container as HTMLElement, 'footer@zh-CN')
  })

  it('scans the gift gallery', async () => {
    const { container } = render(inZh(<GiftGallery gifts={giftItems.slice(0, 4)} />))
    await expectNoViolations(container as HTMLElement, 'gift-gallery@zh-CN')
  })

  it('scans the app bar, including both language switcher instances', async () => {
    // 本组是新增扫描面：桌面实例与移动实例在 jsdom 里同时在 DOM 中，
    // 两个 `role="group"` + `aria-label` 的可及名与 aria-current 都在这里被扫描。
    const { container } = render(
      inZh(
        <WishlistProvider>
          <AppBar />
        </WishlistProvider>,
      ),
    )
    await expectNoViolations(container as HTMLElement, 'app-bar@zh-CN')
  })
})

describe('a11y: heading-order across assembled landing sections under zh-CN', () => {
  it('h1 then sr-only h2 then h3 in PromiseStrip (no jump from h1 to h3)', async () => {
    const { container } = render(
      inZh(
        <>
          <h1>Evoloop</h1>
          <PromiseStrip locale="zh-CN" />
        </>,
      ),
    )
    const res = await expectNoViolations(container as HTMLElement, 'hero+promise@zh-CN')
    // 与默认语言那份相同的断言：中文词典不改变标题层级，h2 仍是 h1→h3 的桥梁。
    const headings = Array.from(container.querySelectorAll('h1, h2, h3')).map((h) =>
      Number(h.tagName.slice(1)),
    )
    expect(headings).toEqual([1, 2, 3, 3, 3])
    void res
  })
})

describe('a11y: zh-CN 语言上下文确实生效（本文件其余断言的锚点）', () => {
  /** 这一组不是 axe 扫描，而是**证明上面那些断言跑在 zh-CN 语境里**：
   * `aria-current` 由 `useLocale()` 决定、与词典无关，若 `LocaleProvider` 的 `locale`
   * 被写回默认语言（或漏传、被改成 `en`），当前语言标记会落到 `EN` 上，此断言立刻变红。
   * 没有它，把 Provider 换成默认语言后上面的 axe 扫描仍会全绿（文案来自词典、结构不变），
   * 本文件就会退化成「又扫了一遍默认语言」的空转。 */
  it('切换器把「中文」标为当前语言，AppBar 文案取自 zh-CN 词典', () => {
    nav.pathname = '/zh-CN/shop'
    render(
      inZh(
        <WishlistProvider>
          <AppBar />
        </WishlistProvider>,
      ),
    )

    const groups = screen.getAllByRole('group', { name: '切换语言' })
    expect(groups).toHaveLength(2)
    for (const group of groups) {
      expect(within(group).getByRole('link', { name: '中文' })).toHaveAttribute(
        'aria-current',
        'true',
      )
      expect(within(group).getByRole('link', { name: 'EN' })).not.toHaveAttribute('aria-current')
      // 跨语言链接自己解析 href（`LocaleLink` 会叠成 /en/zh-CN/shop，见裁决 R38）。
      expect(within(group).getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en/shop')
      expect(within(group).getByRole('link', { name: '中文' })).toHaveAttribute(
        'href',
        '/zh-CN/shop',
      )
    }
  })
})
