import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageMetadataOverrides } from './seo'
import { site } from './site'
import { LOCALES } from '@/i18n/locales'

const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'

/**
 * 编译期夹具：页面不得自造 `openGraph.url`（它与 canonical 同源，自造会导致两者不一致）。
 * `PageMetadataOverrides.openGraph` 上的 `url?: never` 是这条禁止的实现，本行的
 * `@ts-expect-error` 就是它的守卫：禁止一旦被改回 `Omit` 或删掉，这个赋值不再报错，
 * `npm run typecheck` 会因 `@ts-expect-error` 未生效报 TS2578。
 *
 * 该夹具只在类型层成立，运行时无守卫——真正的运行时断言见下方「自造的 url 压不过 canonical」。
 */
// @ts-expect-error — openGraph.url 在 PageMetadataOverrides 上被类型级禁止（统一由 pageMetadata 产出）
const selfMadeOgUrl: PageMetadataOverrides = { openGraph: { url: 'https://example.com/self-made' } }

afterEach(() => {
  delete process.env[ENV_KEY]
  vi.resetModules()
})

describe('seo metadata helpers', () => {
  it("baseMetadataFor('en') defaults to the site brand and print-to-order promise", async () => {
    const { baseMetadataFor } = await import('./seo')
    const baseMetadata = baseMetadataFor('en')
    expect(baseMetadata.title).toMatchObject({ default: site.name })
    expect(String((baseMetadata.title as { template?: string }).template)).toContain(site.name)
    expect(baseMetadata.description).toContain('printed to order')
  })

  it('pageMetadata keeps the brand title template when nothing overrides it', async () => {
    const { pageMetadata } = await import('./seo')
    const merged = pageMetadata('en', {})
    expect(typeof merged.title).toBe('object')
    expect(String((merged.title as { template?: string }).template)).toContain(site.name)
    expect(merged.openGraph).toMatchObject({
      // OG 图逐语言（裁决 R25）：`/og?locale=` 的生产消费者就是这里
      images: ['/og?locale=en'],
      siteName: site.name,
    })
  })

  it('pageMetadata shallow-merges a page override onto the base', async () => {
    const { pageMetadata } = await import('./seo')
    const merged = pageMetadata('en', {
      title: 'Shop',
      description: 'All styles, printed to order.',
    })
    expect(merged.title).toBe('Shop')
    expect(merged.description).toBe('All styles, printed to order.')
    // openGraph from base is inherited when the page does not set its own
    expect(merged.openGraph).toMatchObject({ siteName: site.name })
  })

  it('metadataBase honours NEXT_PUBLIC_SITE_URL and falls back for bad values', async () => {
    process.env[ENV_KEY] = 'https://evoloop.example'
    const { baseMetadataFor } = await import('./seo')
    const b1 = baseMetadataFor('en')
    expect(String(b1.metadataBase)).toBe('https://evoloop.example/')

    delete process.env[ENV_KEY]
    vi.resetModules()
    const b2 = baseMetadataFor('en')
    expect(String(b2.metadataBase)).toBe('http://localhost:3000/')

    process.env[ENV_KEY] = 'not a url'
    vi.resetModules()
    const b3 = baseMetadataFor('en')
    expect(String(b3.metadataBase)).toBe('http://localhost:3000/')

    process.env[ENV_KEY] = 'ftp://files.example'
    vi.resetModules()
    const b4 = baseMetadataFor('en')
    expect(String(b4.metadataBase)).toBe('http://localhost:3000/')
  })
})

// 逐语言 metadata（规格 §8.5）。绝对 URL 的基址由 `absoluteUrl` 每次调用重读 env，
// 因此这里显式钉到正式域：期望值才与部署形态一致，也才不会退化成「拿实现算期望值」。
describe('alternatesFor', () => {
  beforeEach(() => {
    process.env[ENV_KEY] = site.url
  })

  it('canonical 指向自身的 locale 绝对 URL', async () => {
    const { alternatesFor } = await import('./seo')
    expect(alternatesFor('en', '/shop').canonical).toBe(`${site.url}/en/shop`)
  })

  it('静态页 /shop 在两种语言下都存在：成对输出 hreflang 与 x-default', async () => {
    const { alternatesFor } = await import('./seo')
    // 期望值随 `LOCALES` 变化（裁决 R35）：「每一种已声明语言」现在是 en 与 zh-CN。
    // 这里断言的是**静态页** `/shop`（内容就是界面文案，两种语言都有），所以按实际译文收窄
    // 内容页之后本断言仍应保持成对——它若变红说明静态页被误判为不可用（收窄做错了）。
    expect(alternatesFor('en', '/shop').languages).toEqual({
      en: `${site.url}/en/shop`,
      'zh-CN': `${site.url}/zh-CN/shop`,
      'x-default': `${site.url}/en/shop`,
    })
  })

  it('hreflang 由 availableLocales 参数驱动：只有 en 时不发 zh-CN，全语言时才发', async () => {
    const { alternatesFor } = await import('./seo')
    // 同一个 path 两种传参：收窄是参数驱动的事实，不是「某个页面被写死了 en」。
    expect(Object.keys(alternatesFor('en', '/blog/x', ['en']).languages ?? {})).not.toContain(
      'zh-CN',
    )
    expect(Object.keys(alternatesFor('en', '/blog/x', LOCALES).languages ?? {})).toContain('zh-CN')
  })

  it('availableLocales 为空时不输出 hreflang 对（回退内容的资格判定，规格 §8.2）', async () => {
    const { alternatesFor } = await import('./seo')
    expect(alternatesFor('en', '/blog/foo', []).languages).toBeUndefined()
  })

  it('canonical 只认自身语言，不随 availableLocales 漂移', async () => {
    const { alternatesFor } = await import('./seo')
    const { canonical, languages } = alternatesFor('en', '/shop', ['en'])
    expect(canonical).toBe(`${site.url}/en/shop`)
    expect(languages).toEqual({ en: `${site.url}/en/shop`, 'x-default': `${site.url}/en/shop` })
  })
})

describe('pageMetadata 的逐语言输出', () => {
  beforeEach(() => {
    process.env[ENV_KEY] = site.url
  })

  it('canonical 是该语言的自指绝对 URL，不再是根路径', async () => {
    const { pageMetadata } = await import('./seo')
    expect(pageMetadata('en', { title: 'Shop', path: '/shop' }).alternates?.canonical).toBe(
      `${site.url}/en/shop`,
    )
  })

  it('path 缺省时退到该语言的站点根，而不是无前缀的 /', async () => {
    const { pageMetadata } = await import('./seo')
    expect(pageMetadata('en', { title: 'Shop' }).alternates?.canonical).toBe(`${site.url}/en`)
  })

  it('openGraph.locale 随 locale（OGP 用下划线形态）', async () => {
    const { pageMetadata } = await import('./seo')
    expect(pageMetadata('en', { title: 'Shop', path: '/shop' }).openGraph?.locale).toBe('en_US')
  })

  it('OG 图与 openGraph.url 都逐语言，且 url 与 canonical 同源', async () => {
    const { pageMetadata } = await import('./seo')
    const meta = pageMetadata('en', { title: 'Shop', path: '/shop' })
    expect(meta.openGraph?.images).toEqual(['/og?locale=en'])
    expect(meta.twitter?.images).toEqual(['/og?locale=en'])
    expect(meta.openGraph?.url).toBe(`${site.url}/en/shop`)
  })

  it('页面塞进自造的 openGraph.url 也压不过 canonical（与类型级禁止互补）', async () => {
    const { pageMetadata } = await import('./seo')
    // selfMadeOgUrl 的赋值在类型层已被拒（见文件头夹具）；这里钉住运行时的兜底顺序：
    // pageMetadata 在展开 overrides 之后才写 url，页面给的值不可能盖掉 canonical。
    const meta = pageMetadata('en', { title: 'Shop', path: '/shop', ...selfMadeOgUrl })
    expect(meta.openGraph?.url).toBe(`${site.url}/en/shop`)
  })

  it('页面自带 OG 图时不被默认的逐语言 OG 图顶掉', async () => {
    const { pageMetadata } = await import('./seo')
    const meta = pageMetadata('en', {
      title: 'Shop',
      path: '/shop',
      openGraph: { images: ['/blog/covers/x.webp'] },
    })
    expect(meta.openGraph?.images).toEqual(['/blog/covers/x.webp'])
    expect(meta.twitter?.images).toEqual(['/og?locale=en'])
  })

  it('品牌基座字段（metadataBase / description / openGraph 品牌项）不被逐语言逻辑改动', async () => {
    const { pageMetadata } = await import('./seo')
    const meta = pageMetadata('en', { title: 'Shop', path: '/shop' })
    expect(meta.metadataBase).toBeDefined()
    expect(meta.description).toContain('printed to order')
    expect(meta.openGraph).toMatchObject({ siteName: site.name, type: 'website' })
  })
})

// 英文侧不回归的守卫。期望值**逐字复制**自改造前的 `src/lib/seo.ts`（`baseDescription` 与
// `keywords`，见 `git show e18fd1c:src/lib/seo.ts`）：刻意手写，不从 `messages('en')` 反推——
// 从实现取期望值等于让实现自证，英文文案被悄悄改掉时守卫不会红。
const LEGACY_BASE_DESCRIPTION =
  'Casual shoes printed to order with digital manufacturing, millimetre-based sizing, and a lower-inventory footprint.'
const LEGACY_KEYWORDS = ['Evoloop', 'made-to-order shoes', '3D printed shoes', 'shoe sizing guide']

describe('baseMetadataFor 的逐语言基座', () => {
  it('英文 description 与改造前逐字相同', async () => {
    const { baseMetadataFor } = await import('./seo')
    expect(baseMetadataFor('en').description).toBe(LEGACY_BASE_DESCRIPTION)
  })

  it('英文 keywords 与改造前同元素同顺序（逗号分隔的词典值原样还原成数组）', async () => {
    const { baseMetadataFor } = await import('./seo')
    expect(baseMetadataFor('en').keywords).toEqual(LEGACY_KEYWORDS)
  })

  it('og:locale 随 locale（OGP 用下划线形态）', async () => {
    const { baseMetadataFor } = await import('./seo')
    expect(baseMetadataFor('en').openGraph?.locale).toBe('en_US')
    expect(baseMetadataFor('zh-CN').openGraph?.locale).toBe('zh_CN')
  })

  it('两种语言的 description 不同，且每种语言的 keywords 都是非空数组', async () => {
    const { baseMetadataFor } = await import('./seo')
    expect(baseMetadataFor('zh-CN').description).not.toBe(baseMetadataFor('en').description)
    for (const locale of LOCALES) {
      const keywords = baseMetadataFor(locale).keywords
      expect(Array.isArray(keywords), `${locale} 的 keywords 必须是数组`).toBe(true)
      expect(keywords as string[], `${locale} 的 keywords 不得为空`).not.toHaveLength(0)
      // 词典值里多一个分隔符或多一个逗号后的空格都不该产出空词条
      expect(keywords as string[], `${locale} 的 keywords 不得含空词条`).not.toContain('')
    }
  })

  it('不携带 canonical：alternates 只由页面级 pageMetadata 给出', async () => {
    const { baseMetadataFor } = await import('./seo')
    expect(baseMetadataFor('en').alternates).toBeUndefined()
    expect(baseMetadataFor('zh-CN').alternates).toBeUndefined()
  })
})
