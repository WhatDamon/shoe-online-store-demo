import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { pageMetadata } from '@/lib/seo'
import { site } from '@/lib/site'
import BlogPostPage, { generateMetadata } from './page'

/**
 * 博客详情页的**真实接线**测试（阶段 2 修复轮 1 的 P1-C / P1-B）。
 *
 * 刻意**不** mock `@/lib/blog`：这条接线的两个产物——canonical/hreflang（任务 6）与结构化数据的
 * `inLanguage`/`@id`（规格 §8.3）——必须由真实内容层的可用性判定与回退逻辑驱动，否则「回退页的
 * URL 段语言 ≠ 内容语言」这条接线又只剩下读码这一种验收方式。
 *
 * 夹具是**真实存在**的未译文章（阶段 2 没有 `content/blog/zh-CN/`）：`/zh-CN` 下它是回退页，
 * 正文是英文原文，`sourceLocale === 'en'`。
 */
const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'
const UNTRANSLATED_SLUG = 'finding-your-evoloop-size'

const params = (locale: string) =>
  Promise.resolve({ locale, slug: UNTRANSLATED_SLUG }) as Promise<{
    locale: string
    slug: string
  }>

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
  // 绝对 URL 的基址逐次调用读取（`seo.ts` 的 `resolveBaseUrl`），故期望值可以钉正式域。
  process.env[ENV_KEY] = site.url
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('/zh-CN 的回退文章页：canonical 与 hreflang 按内容语言产出', () => {
  it('generateMetadata 的 canonical 指向 /en/ 原文，hreflang 只有 en 与 x-default', async () => {
    const meta = await generateMetadata({ params: params('zh-CN') })
    expect(meta.alternates?.canonical).toBe(`${site.url}/en/blog/${UNTRANSLATED_SLUG}`)
    // 「未译页不发成对 hreflang」在这里是键集断言：多出 'zh-CN' 就是发出了假 alternate。
    expect(Object.keys(meta.alternates?.languages ?? {})).toEqual(['en', 'x-default'])
    // 两条都必须落在默认语言的同一 slug 地址上（回退页不是另一个页面）
    expect(meta.alternates?.languages).toEqual({
      en: `${site.url}/en/blog/${UNTRANSLATED_SLUG}`,
      'x-default': `${site.url}/en/blog/${UNTRANSLATED_SLUG}`,
    })
  })

  it('og:url 与 canonical 同源，og:locale 也按内容语言（en_US）而不是 URL 段语言', async () => {
    const meta = await generateMetadata({ params: params('zh-CN') })
    expect(meta.openGraph?.url).toBe(`${site.url}/en/blog/${UNTRANSLATED_SLUG}`)
    expect(meta.openGraph?.locale).toBe('en_US')
  })

  /**
   * 反向守卫：已译页必须 canonical **自指** `/zh-CN/...`，即「内容语言」是逐页变量而不是常量 `en`。
   *
   * 阶段 2 的仓库里没有真实译文，页面也没有内容目录接缝（`getLocalizedPost(slug, locale)` 用默认
   * 目录），所以这条在**产出 canonical 的组装点**（`pageMetadata`）上钉：最危险的失效模式是把
   * `sourceLocale` 当成永远是 `en`，那会让每一篇已译文章的 canonical 塌到英文页（规格 §8.3 明令
   * 已译页自指）。
   */
  it('已译页 canonical 自指 /zh-CN 且成对发 hreflang（内容语言不是常量 en）', () => {
    const meta = pageMetadata('zh-CN', {
      path: `/blog/${UNTRANSLATED_SLUG}`,
      availableLocales: ['en', 'zh-CN'],
    })
    expect(meta.alternates?.canonical).toBe(`${site.url}/zh-CN/blog/${UNTRANSLATED_SLUG}`)
    expect(Object.keys(meta.alternates?.languages ?? {})).toEqual(['en', 'zh-CN', 'x-default'])
  })
})

describe('/zh-CN 的回退文章页：结构化数据用内容语言（规格 §8.3）', () => {
  it('Article 的 inLanguage 是 en、@id 与 mainEntityOfPage 用 /en/ 前缀', async () => {
    render(await BlogPostPage({ params: params('zh-CN') }))
    const article = jsonLd('Article')
    expect(article.inLanguage).toBe('en')
    expect(article['@id']).toBe(`${site.url}/en/blog/${UNTRANSLATED_SLUG}#article`)
    expect(article.mainEntityOfPage).toBe(`${site.url}/en/blog/${UNTRANSLATED_SLUG}`)
  })

  it('BreadcrumbList 的 item URL 也走内容语言前缀（与 canonical 同一语言）', async () => {
    render(await BlogPostPage({ params: params('zh-CN') }))
    const crumbs = jsonLd('BreadcrumbList').itemListElement as { item: string }[]
    expect(crumbs.map((crumb) => crumb.item)).toEqual([
      `${site.url}/en`,
      `${site.url}/en/blog`,
      `${site.url}/en/blog/${UNTRANSLATED_SLUG}`,
    ])
  })
})
