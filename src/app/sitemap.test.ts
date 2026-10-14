import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LOCALES } from '@/i18n/locales'
import { availableLocalesFor } from '@/lib/blog'
import { alternatesFor } from '@/lib/seo'
import { site } from '@/lib/site'
import sitemap from './sitemap'

/**
 * 负向对照 C 的注入点：只把**内容目录**换到临时目录夹具（`dir` 是 `blog.ts` 自己提供的接缝），
 * 可用性判断本身仍是真实实现——不是把一个写死的 `['en','zh-CN']` 塞进去。
 * 默认 `dir: null`（不重定向）：本文件其余断言仍然读真实 `content/blog/` 目录。
 */
const contentDir = vi.hoisted(() => ({ override: null as string | null }))

vi.mock('@/lib/blog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/blog')>()
  return {
    ...actual,
    availableLocalesFor: (slug: string, dir?: string) =>
      actual.availableLocalesFor(slug, contentDir.override ?? dir),
  }
})

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
    // 期望值随 `LOCALES` 变化（裁决 R35）：默认 `availableLocales` 是全部已声明语言。
    // 首页是**静态页**（内容就是界面文案，两种语言都有），所以收窄未译内容页之后本断言
    // 仍应保持成对——它若变红说明静态页被误判为不可用（收窄做错了），不是「期望值过时」。
    expect(home?.alternates?.languages).toEqual({
      en: `${site.url}/en`,
      'zh-CN': `${site.url}/zh-CN`,
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

// ── 未译内容绝不发假信号（阶段 2 任务 6 的收口点）──────────────────────────────
// 「未译内容绝不发 hreflang、绝不进 zh-CN sitemap」：假 alternate 会让搜索引擎把英文页
// 当中文页收录，比没有 alternate 更伤。
describe('未译内容不进 zh-CN sitemap、不发 zh-CN hreflang', () => {
  it('zh-CN sitemap 只含静态页，未译的文章与商品一条都没有', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls).toContain(`${site.url}/zh-CN`)
    expect(urls).toContain(`${site.url}/zh-CN/shop`)
    expect(urls).toContain(`${site.url}/zh-CN/blog`)
    // 「一条都不许有」，不是「数量对不上」
    expect(urls.filter((url) => url.includes('/zh-CN/blog/'))).toEqual([])
    expect(urls.filter((url) => url.includes('/zh-CN/product/'))).toEqual([])
  })

  it('en sitemap 仍然完整（收窄不得误伤默认语言）', async () => {
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls).toContain(`${site.url}/en/blog/finding-your-evoloop-size`)
    expect(urls).toContain(`${site.url}/en/product/dc-1001`)
  })

  it('未译文章的 hreflang 只有 en 与 x-default（真实 slug + 真实可用性判定）', async () => {
    const slug = 'finding-your-evoloop-size'
    // 刻意不传字面量 ['en']：这里要测的是 availableLocalesFor 的真实返回值在驱动 hreflang。
    expect(availableLocalesFor(slug)).toEqual(['en'])
    const { languages } = alternatesFor('en', `/blog/${slug}`, availableLocalesFor(slug))
    expect(Object.keys(languages ?? {})).toEqual(['en', 'x-default'])
  })

  it('机制随译文出现而翻转：造出 zh-CN/<slug>.md 后该文章才进 zh-CN sitemap（临时目录夹具）', async () => {
    const slug = 'finding-your-evoloop-size'
    const zhUrl = `${site.url}/zh-CN/blog/${slug}`
    // 夹具：同一篇文章，先只有默认语言正文，再补一份中文译文。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-i18n-'))
    try {
      fs.writeFileSync(
        path.join(dir, `${slug}.md`),
        '---\ntitle: Finding your size\ndate: 2026-09-06\n---\nEnglish body\n',
      )
      contentDir.override = dir
      // 没有译文：zh-CN 下不该有这篇文章的任何信号
      expect(availableLocalesFor(slug)).toEqual(['en'])
      expect((await sitemap()).map((entry) => entry.url)).not.toContain(zhUrl)

      // 译文落地 → sitemap 与 hreflang 必须立刻跟着翻（真实 existsSync 判定，不是写死的）
      fs.mkdirSync(path.join(dir, 'zh-CN'))
      fs.writeFileSync(
        path.join(dir, 'zh-CN', `${slug}.md`),
        '---\ntitle: 如何选尺码\ndate: 2026-09-06\n---\n中文正文\n',
      )
      expect(availableLocalesFor(slug)).toEqual(['en', 'zh-CN'])
      const entries = await sitemap()
      expect(
        entries.find((candidate) => candidate.url === zhUrl)?.alternates?.languages?.['zh-CN'],
      ).toBe(zhUrl)
      // 默认语言那一份没有被顶掉（收窄只影响未译语言）
      expect(entries.map((candidate) => candidate.url)).toContain(`${site.url}/en/blog/${slug}`)
      expect(
        Object.keys(
          alternatesFor('en', `/blog/${slug}`, availableLocalesFor(slug)).languages ?? {},
        ),
      ).toContain('zh-CN')
    } finally {
      contentDir.override = null
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
