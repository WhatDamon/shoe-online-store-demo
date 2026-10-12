import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCALES } from '@/i18n/locales'
import { site } from '@/lib/site'
import sitemap from './sitemap'

const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'

beforeEach(() => {
  process.env[ENV_KEY] = site.url
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('sitemap', () => {
  it('每条 URL 都带某一种已声明语言的 locale 前缀', async () => {
    const entries = await sitemap()
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const { pathname } = new URL(entry.url)
      const localized = LOCALES.some(
        (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
      )
      expect(localized, `${entry.url} 未带 locale 前缀`).toBe(true)
    }
  })

  it('站点级路径按语言逐条展开', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    for (const locale of LOCALES) {
      expect(urls).toContain(`${site.url}/${locale}`)
      expect(urls).toContain(`${site.url}/${locale}/shop`)
      expect(urls).toContain(`${site.url}/${locale}/blog`)
    }
  })

  it('为已译页面输出成对 hreflang（含 x-default）', async () => {
    const home = (await sitemap()).find((entry) => entry.url === `${site.url}/en`)
    expect(home?.alternates?.languages).toEqual({
      en: `${site.url}/en`,
      'x-default': `${site.url}/en`,
    })
  })

  it('商品与文章条目确实进了 sitemap（不是只有站点级 3 条）', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    // 钉真实存在的 handle / slug，而不是数量（数量随目录漂移，且删掉 products/posts 两段
    // 仍可能因静态条目与图片断言而全绿）。
    expect(urls).toContain(`${site.url}/en/product/dc-1001`)
    expect(urls).toContain(`${site.url}/en/blog/finding-your-evoloop-size`)
  })

  it('同一 URL 不重复出现', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('沿用既有的最后修改时间口径：全都有时间，站点级沿用 SITE_UPDATED', async () => {
    const entries = await sitemap()
    expect(entries.every((entry) => entry.lastModified !== undefined)).toBe(true)
    // 与实现里的 SITE_UPDATED 同源；调整那个常量需要同步此处（不编造新时间）
    expect(entries.find((entry) => entry.url === `${site.url}/en`)?.lastModified).toBe('2026-09-23')
  })

  it('商品/文章图片是静态资源，不加 locale 前缀', async () => {
    const entries = await sitemap()
    const images = entries.flatMap((entry) => entry.images ?? [])
    expect(images.length).toBeGreaterThan(0)
    for (const image of images) {
      const { pathname } = new URL(image)
      expect(LOCALES.some((locale) => pathname.startsWith(`/${locale}/`))).toBe(false)
    }
  })
})
