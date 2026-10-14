// PrintSpecSheet 政策句的**按语言**守卫（与受保护的 `print-spec-sheet.test.tsx` 互补，不合并）。
//
// 为什么另开新文件：那个文件的三条断言是默认语言串（含 `getAllByText(POLICY_RETURNS)`，
// 直接钉在 `store-policy` 常量上），且在受保护清单里。本轮修的是**该文件看不到的缺陷**：
// zh-CN 页面印出英文政策句——组件读的是默认语言常量而不是收到的 `locale`。
// 故按既有 i18n 测试的做法（同 `my-size-guide-i18n.test.tsx`）纯新增：断言两种语言下的
// **完整句子字面量**，两侧互斥（zh 下英文原文必须缺席、en 下中文必须缺席）。
//
// 期望值不引用词典/常量：写死字面量，词典被改错时这里会红，而引用 `messages(...)` 只会
// 让断言跟着错值一起漂移（那样也钉不住「这行文字来自哪本词典」）。
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrintSpecSheet } from './print-spec-sheet'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { messages } from '@/i18n/messages'
import type { Locale } from '@/i18n/locales'
import type { ProductView } from '@/domain/product'

const EN_PRODUCTION =
  'Every pair is printed to order in our studio, so nothing sits in a warehouse — we only print what you buy.'
const EN_RETURNS =
  "Because each pair is made to your order, custom-printed items can't be returned or refunded. If your pair arrives faulty or the fit is not as promised, message us within 30 days and we'll sort it out."
const ZH_PRODUCTION = '每一双都在我们的工作室按订单打印，所以不占仓库 —— 只打印你买的那双。'
const ZH_RETURNS =
  '每一双都按你的订单制作，因此定制打印商品不支持退货或退款。如果收到的鞋有质量问题，或合脚程度与承诺不符，请在 30 天内联系我们，我们会为你处理。'

const p: ProductView = {
  id: 'p01',
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'x',
  description: 'A soft everyday sneaker.',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [42, 43],
  features: ['Made to order', 'Fits true to size'],
  fitNotes: 'Roomy toe box',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
  visual: { palette: ['#111111', '#0f766e'], accent: '#0f766e', views: 3 },
  createdAt: '2026-08-01T00:00:00Z',
  colors: [{ name: 'Ivory', hex: '#f4f1ea' }],
  sizeOptions: [
    { value: 42, label: 'US 8.5' },
    { value: 43, label: 'US 9' },
  ],
}

// 本组件是服务端组件，语言由 `locale` prop 传入（PDP 传 URL 语言）；Provider 是**附挂**：
// 既复现 PDP 里「词典 Provider + 显式 locale」的并存，也把「以后误改成 `useMessages()`
// 而不改 prop」这条路堵住（两种取法给到同一本词典，断言不会因此误红/误绿）。
function renderSheet(locale: Locale): void {
  render(
    <LocaleProvider locale={locale} messages={messages(locale)}>
      <PrintSpecSheet product={p} locale={locale} />
    </LocaleProvider>,
  )
}

/** 政策句渲染在独立 `<p>` 里：用整串定位，归一化空白后逐字比较。 */
function expectPolicyLines(present: string[], absent: string[]): void {
  for (const sentence of present) {
    const node = screen.getByText(sentence)
    expect(node.textContent).toBe(sentence)
  }
  for (const sentence of absent) {
    expect(screen.queryByText(sentence)).toBeNull()
  }
}

describe('PrintSpecSheet 政策句按语言取词典', () => {
  it('zh-CN：印刷单上的制作与退货政策是中文整句，英文原文缺席', () => {
    renderSheet('zh-CN')

    expectPolicyLines([ZH_PRODUCTION, ZH_RETURNS], [EN_PRODUCTION, EN_RETURNS])
  })

  it('en：印刷单仍是英文整句（默认语言未回归），中文缺席', () => {
    renderSheet('en')

    expectPolicyLines([EN_PRODUCTION, EN_RETURNS], [ZH_PRODUCTION, ZH_RETURNS])
  })
})
