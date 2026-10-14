import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { site } from '@/lib/site'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import ProductPage from './page'

/**
 * 商品详情页的**真实接线**测试（阶段 2 修复轮 1 的 P1-B）。
 *
 * 阶段 2 的**有意口径**：商品文案（标题/描述/`additionalProperty` 标签）只有英文，
 * `/zh-CN/product/<handle>` 是回退页。结构化数据的 `locale` 参数是**内容语言**（`DEFAULT_LOCALE`），
 * 不是 URL 段语言——否则 `@id` 会声明成 `/zh-CN/product/<handle>#product`，与 canonical 指向的
 * `/en/product/<handle>` 自相矛盾（同一个提交里两条相反的声明，规格 §8.3）。
 *
 * 只断言结构化数据；页面的文案与购买条由各自组件的测试负责。
 */
const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'
const HANDLE = 'dc-1001'

const params = (locale: string) =>
  Promise.resolve({ locale, handle: HANDLE }) as Promise<{ locale: string; handle: string }>

/** 取出页面里的 JSON-LD 节点（`@type` 匹配），解析回对象便于逐字段断言。 */
function jsonLd(type: string): Record<string, unknown> {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
  for (const script of scripts) {
    const data = JSON.parse(script.textContent ?? 'null') as Record<string, unknown>
    if (data?.['@type'] === type) return data
  }
  throw new Error(`页面里没有 @type=${type} 的 JSON-LD`)
}

beforeEach(() => {
  process.env[ENV_KEY] = site.url
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

/** PDP 的收藏按钮走 `useWishlist`，需要 Provider（与 `extracted-copy.test.tsx` 同一封装）。 */
const renderPdp = async (locale: string) =>
  render(<WishlistProvider>{await ProductPage({ params: params(locale) })}</WishlistProvider>)

describe('/zh-CN 的商品回退页：结构化数据用内容语言', () => {
  it('Product 的 @id 用 /en/ 前缀，不随 URL 段语言漂移', async () => {
    await renderPdp('zh-CN')
    const product = jsonLd('Product')
    expect(product['@id']).toBe(`${site.url}/en/product/${HANDLE}#product`)
  })

  it('BreadcrumbList 的 item URL 也走内容语言前缀', async () => {
    await renderPdp('zh-CN')
    const crumbs = jsonLd('BreadcrumbList').itemListElement as { item: string }[]
    expect(crumbs.map((crumb) => crumb.item)).toEqual([
      `${site.url}/en`,
      `${site.url}/en/shop`,
      `${site.url}/en/product/${HANDLE}`,
    ])
  })
})
