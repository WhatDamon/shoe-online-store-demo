import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { site } from '@/lib/site'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { messages } from '@/i18n/messages'
import ProductPage from './product/[handle]/page'
import BlogPostPage from './blog/[slug]/page'

/**
 * 回退页的 JSON-LD 面包屑：**名与地址必须同语言**（R49 / ADR 0009 决策 4）。
 *
 * `src/lib/structured-data.ts` 的模块注释把「结构化数据 = 内容语言」写成了本文件所有构造器的
 * 契约。阶段 2 的回退页（中文 URL、英文正文）里，`breadcrumbSchema` 的 `locale` 传的是**内容
 * 语言**，故 `item` URL 带 `/en` 前缀；但 crumb 的 `name` 一度取自 **URL 语言**的词典，于是
 * 发出一条自相矛盾的节点：中文名 + `/en/...` 地址。本文件把两侧都钉住——
 * **JSON-LD 的 `name` 是英文**（与它的 URL 同语言），而**页面可见的导航仍是中文**（R49：句子级
 * UI 文案用 URL 语言）。两者同页并存不是矛盾，是本阶段的口径。
 *
 * 夹具是真实存在的未译内容：`content/blog/` 下没有 `zh-CN/` 目录，商品文案的翻译排在阶段 3。
 * 期望值一律写**逐字字面量**（不走词典取值），词典被改一个字这里就红——与
 * `src/app/[locale]/extracted-copy.test.tsx` 同一纪律。已译页上 `sourceLocale === locale`，
 * 本文件的断言对它是 no-op（同一份词典）。
 */
const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'
const HANDLE = 'dc-1001'
const PRODUCT_TITLE = 'Urban Bloom'
const UNTRANSLATED_SLUG = 'finding-your-evoloop-size'
const POST_TITLE = 'How to find your Evoloop size'

/** 取出页面里的 JSON-LD 节点（`@type` 匹配），解析回对象便于逐字段断言。 */
function jsonLd(type: string): Record<string, unknown> {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
  for (const script of scripts) {
    const data = JSON.parse(script.textContent ?? 'null') as Record<string, unknown>
    if (data?.['@type'] === type) return data
  }
  throw new Error(`页面里没有 @type=${type} 的 JSON-LD`)
}

const crumbList = () => jsonLd('BreadcrumbList').itemListElement as { name: string; item: string }[]
/** 逐字取 crumb 的 `name`（英文，内容语言）；`@type` / `position` 由 `structured-data.test.ts` 负责。 */
const crumbNames = () => crumbList().map((crumb) => crumb.name)
const crumbItems = () => crumbList().map((crumb) => crumb.item)

beforeEach(() => {
  process.env[ENV_KEY] = site.url
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

/** 商品页的收藏按钮与导航链接都走上下文，故与生产同形地挂上两个 Provider。 */
const renderPdpZh = async () =>
  render(
    <LocaleProvider locale="zh-CN" messages={messages('zh-CN')}>
      <WishlistProvider>
        {await ProductPage({ params: Promise.resolve({ locale: 'zh-CN', handle: HANDLE }) })}
      </WishlistProvider>
    </LocaleProvider>,
  )

const renderPostZh = async () =>
  render(
    <LocaleProvider locale="zh-CN" messages={messages('zh-CN')}>
      {await BlogPostPage({
        params: Promise.resolve({ locale: 'zh-CN', slug: UNTRANSLATED_SLUG }),
      })}
    </LocaleProvider>,
  )

describe('/zh-CN/product/<handle>（回退页）：面包屑名与 /en 地址同语言', () => {
  it('crumb 名逐字是英文，item 逐字带 /en 前缀', async () => {
    await renderPdpZh()
    expect(crumbNames()).toEqual(['Home', 'Shop', PRODUCT_TITLE])
    expect(crumbItems()).toEqual([
      `${site.url}/en`,
      `${site.url}/en/shop`,
      `${site.url}/en/product/${HANDLE}`,
    ])
  })

  it('页面可见的返回链接仍是中文（R49：句子级 UI 文案用 URL 语言）', async () => {
    await renderPdpZh()
    expect(screen.getByRole('link', { name: '全部鞋款' }).textContent).toBe('全部鞋款')
    expect(screen.queryByRole('link', { name: 'All shoes' })).toBeNull()
  })
})

describe('/zh-CN/blog/<未译 slug>（回退页）：面包屑名与 /en 地址同语言', () => {
  it('crumb 名逐字是英文，item 逐字带 /en 前缀', async () => {
    await renderPostZh()
    expect(crumbNames()).toEqual(['Home', 'Journal', POST_TITLE])
    expect(crumbItems()).toEqual([
      `${site.url}/en`,
      `${site.url}/en/blog`,
      `${site.url}/en/blog/${UNTRANSLATED_SLUG}`,
    ])
  })

  it('页面可见的返回链接与回退提示条仍是中文', async () => {
    await renderPostZh()
    expect(screen.getByRole('link', { name: '全部文章' }).textContent).toBe('全部文章')
    expect(screen.queryByRole('link', { name: 'All posts' })).toBeNull()
    expect(screen.getByText('本文暂无中文版本，以下为英文原文。').textContent).toBe(
      '本文暂无中文版本，以下为英文原文。',
    )
  })
})
