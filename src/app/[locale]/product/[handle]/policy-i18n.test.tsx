import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { messages } from '@/i18n/messages'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { site } from '@/lib/site'
import ProductPage from './page'

/**
 * PDP 店务政策与保养卡提示的**按语言渲染**（任务 9）。
 *
 * 口径（裁决 R49）：政策句是**句子级 UI 文案**，按 **URL 语言**取词典。这与同页 canonical /
 * JSON-LD 用「内容语言」（商品文案只有英文 → `DEFAULT_LOCALE`）不矛盾：SEO 信号指向内容**实际
 * 可用**的语言，界面句子的语言随 URL。`page.test.tsx` 守前一半，本文件守后一半。
 *
 * 渲染真实 PDP（`await ProductPage(...)` 外套 `LocaleProvider`），不 mock 词典与文案：政策区
 * 与保养卡提示都要经真实组件树才取到值（政策句在页内读 `t`，保养卡提示在客户端组件里读
 * `useLocale()`）。base-ui 手风琴**关闭时不渲染 panel**，故先点开「Shipping & returns」再看。
 *
 * 保养卡（海报与 `POLICY_CARE` 原文）是英文印刷品，翻译会与包装内的实物矛盾：卡面不译，
 * 只在非英文界面加一句说明。因此「zh 下有提示」与「en 下无提示」是一对断言，拆开任一条
 * 都会让「两边都显示/都不显示」的回归漏网。
 */
const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'
const HANDLE = 'dc-1001'

const params = (locale: string) =>
  Promise.resolve({ locale, handle: HANDLE }) as Promise<{ locale: string; handle: string }>

const renderPdp = async (locale: 'en' | 'zh-CN') =>
  render(
    <LocaleProvider locale={locale} messages={messages(locale)}>
      <WishlistProvider>{await ProductPage({ params: params(locale) })}</WishlistProvider>
    </LocaleProvider>,
  )

/** 展开政策手风琴，返回该 panel 的整串文本（关闭时 base-ui 不渲染 panel）。 */
const openPolicyPanel = (locale: 'en' | 'zh-CN') => {
  fireEvent.click(screen.getByRole('button', { name: messages(locale)['pdp.accordion.shipping'] }))
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="accordion-content"]'),
  )
  expect(panels).toHaveLength(1)
  return panels[0].textContent ?? ''
}

beforeEach(() => {
  process.env[ENV_KEY] = site.url
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('PDP 店务政策按 URL 语言渲染', () => {
  it('zh-CN：政策区是中文句子，不是 store-policy 的英文原文', async () => {
    await renderPdp('zh-CN')
    const panel = openPolicyPanel('zh-CN')
    expect(panel).toContain(messages('zh-CN')['pdp.policy.production'])
    expect(panel).toContain(messages('zh-CN')['pdp.policy.returns'])
    // 英文政策句在页面别处仍有渲染（打印规格单直读 `store-policy.ts` 常量），所以
    // 「政策区没有英文原文」必须单独断言，否则「含中文句」证伪不了回退。
    expect(panel).not.toContain(messages('en')['pdp.policy.production'])
  })

  it('en：政策区仍是英文原文（未回归）', async () => {
    await renderPdp('en')
    const panel = openPolicyPanel('en')
    expect(panel).toContain(messages('en')['pdp.policy.production'])
    expect(panel).toContain(messages('en')['pdp.policy.returns'])
  })
})

describe('保养卡提示（卡面是英文印刷品，不译卡面）', () => {
  it('zh-CN：保养说明入口旁显示「卡面为英文原版」提示', async () => {
    await renderPdp('zh-CN')
    expect(screen.getByText(messages('zh-CN')['pdp.policy.careSheetEnglish'])).toBeInTheDocument()
  })

  it('en：英文界面不显示该提示', async () => {
    await renderPdp('en')
    expect(
      screen.queryByText(messages('en')['pdp.policy.careSheetEnglish']),
    ).not.toBeInTheDocument()
  })
})
