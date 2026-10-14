import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageMetadataOverrides } from './seo'
import { site } from './site'

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
  it('baseMetadata defaults to the site brand and print-to-order promise', async () => {
    const { baseMetadata } = await import('./seo')
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
    const { baseMetadata: b1 } = await import('./seo')
    expect(String(b1.metadataBase)).toBe('https://evoloop.example/')

    delete process.env[ENV_KEY]
    vi.resetModules()
    const { baseMetadata: b2 } = await import('./seo')
    expect(String(b2.metadataBase)).toBe('http://localhost:3000/')

    process.env[ENV_KEY] = 'not a url'
    vi.resetModules()
    const { baseMetadata: b3 } = await import('./seo')
    expect(String(b3.metadataBase)).toBe('http://localhost:3000/')

    process.env[ENV_KEY] = 'ftp://files.example'
    vi.resetModules()
    const { baseMetadata: b4 } = await import('./seo')
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

  it('为每种已声明语言成对输出 hreflang 与 x-default', async () => {
    const { alternatesFor } = await import('./seo')
    // 期望值随 `LOCALES` 变化（裁决 R35）：「每一种已声明语言」现在是 en 与 zh-CN。
    // 过渡态期望值（任务 1–5）。任务 6 收口后本断言必然变红，届时改为「未译页面不含 `zh-CN`」。
    expect(alternatesFor('en', '/shop').languages).toEqual({
      en: `${site.url}/en/shop`,
      'zh-CN': `${site.url}/zh-CN/shop`,
      'x-default': `${site.url}/en/shop`,
    })
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
