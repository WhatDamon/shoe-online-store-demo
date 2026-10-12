import { DEFAULT_LOCALE, LOCALES, localePath, type Locale } from '@/i18n/locales'
import { site } from './site'
import type { Metadata } from 'next'

/**
 * 站点绝对基址（OG 图片等需要）。开发环境回退 localhost:3000，
 * 生产环境默认使用正式域名；部署时仍可用 NEXT_PUBLIC_SITE_URL 覆盖。
 * 非法 env 不抛错：按当前环境选择安全回退。
 *
 * **locale 前缀不在这里施加**：本函数保持「一个 path 参数」的形参，
 * 前缀由调用方经 `localePath(locale, path)` 补上（飞行前裁决 R6）。
 */
const DEFAULT_BASE = site.url
const DEV_BASE = 'http://localhost:3000'
const resolveBaseUrl = (): URL => {
  const fallback = process.env.NODE_ENV === 'production' ? DEFAULT_BASE : DEV_BASE
  try {
    const raw = process.env.NEXT_PUBLIC_SITE_URL ?? ''
    if (!raw) return new URL(fallback)
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url
    return new URL(fallback)
  } catch {
    // 入参来自 env，非编译期常量：解析失败按缺省处理，绝不抛出
    return new URL(fallback)
  }
}

export const absoluteUrl = (pathname = '/'): string =>
  new URL(pathname, resolveBaseUrl()).toString()

const baseDescription =
  'Casual shoes printed to order with digital manufacturing, millimetre-based sizing, and a lower-inventory footprint.'

export const baseMetadata: Metadata = {
  metadataBase: resolveBaseUrl(),
  title: { default: site.name, template: `%s — ${site.name}` },
  description: baseDescription,
  keywords: ['Evoloop', 'made-to-order shoes', '3D printed shoes', 'shoe sizing guide'],
  authors: [{ name: site.name, url: site.url }],
  creator: site.name,
  publisher: site.name,
  openGraph: {
    type: 'website',
    url: '/',
    title: site.name,
    description: baseDescription,
    // 没有 locale 上下文时的兜底图；页面级一律走 pageMetadata 的逐语言 OG 图
    images: ['/og'],
    siteName: site.name,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: site.name,
    description: baseDescription,
    images: ['/og'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

/**
 * OGP 的 `og:locale` 用下划线形态（`en_US`），不是 BCP-47 的连字符形态。
 * `Record<Locale, string>` 是刻意的：`LOCALES` 加语言而这里缺一项即编译错误。
 */
const OG_LOCALES: Record<Locale, string> = { en: 'en_US' }

/** OG 图由 `/og` route handler 生成；`?locale=` 由本模块带上（proxy 不替它加前缀）。 */
const ogImage = (locale: Locale): string => `/og?locale=${locale}`

/**
 * 逐语言的 canonical 与 hreflang。
 *
 * - `canonical` 永远是**该 locale 下指向自身**的绝对 URL（规格 §8.5）；
 * - `languages` 只在 `availableLocales` 非空时输出：内容回退页不该向爬虫声明一对
 *   并不存在的译文（规格 §8.2/§8.3）；默认值 `LOCALES` 表达「该页在每种已声明语言下都存在」；
 * - `x-default` 与语言对成对出现，指向默认语言。
 */
export type PageAlternates = {
  canonical: string
  /** 收窄的 hreflang 表：值一律是绝对 URL 字符串（sitemap 与 metadata 共用同一形状） */
  languages?: Record<string, string>
}

export const alternatesFor = (
  locale: Locale,
  path: string,
  availableLocales: readonly Locale[] = LOCALES,
): PageAlternates => ({
  canonical: absoluteUrl(localePath(locale, path)),
  ...(availableLocales.length > 0
    ? {
        languages: {
          ...Object.fromEntries(
            availableLocales.map((available) => [
              available,
              absoluteUrl(localePath(available, path)),
            ]),
          ),
          'x-default': absoluteUrl(localePath(DEFAULT_LOCALE, path)),
        },
      }
    : {}),
})

/**
 * 页面元数据的组装点。locale 是必填的第一参数：canonical、hreflang、`og:locale` 与
 * OG 图 URL 都只能由它决定，调用方无法再自造一个「全站同一处」的 canonical。
 *
 * `path` 是**未带 locale 前缀的站内路径**（`/shop`、`/blog/x`），前缀由本模块经
 * `localePath` 施加；缺省 `/` 落在**该语言的站点根**（`/en`），不是无前缀的 `/`。
 */
export type PageMetadataOverrides = Omit<Partial<Metadata>, 'alternates' | 'openGraph'> & {
  path?: string
  availableLocales?: readonly Locale[]
  /**
   * 页面可覆盖的 OG 字段。`url` 与 `locale` 由本模块统一产出（逐语言自指），
   * 因此在这里从类型上排除（`never` 而不是 `Omit`：Next 的 `OpenGraph` 是联合类型，
   * `Omit` 会把 `type` / `publishedTime` 这类分支专有字段一并抹掉）。
   */
  openGraph?: NonNullable<Metadata['openGraph']> & { url?: never; locale?: never }
}

export const pageMetadata = (
  locale: Locale,
  { path = '/', availableLocales, ...overrides }: PageMetadataOverrides,
): Metadata => {
  const title = typeof overrides.title === 'string' ? overrides.title : undefined
  const canonical = absoluteUrl(localePath(locale, path))
  const image = ogImage(locale)
  return {
    ...baseMetadata,
    ...overrides,
    // alternates 一律由 alternatesFor 产出。baseMetadata 里曾经写死的 `canonical: '/'`
    // 会让所有页面塌到同一处（规格 §8.5 的已知缺陷），因此连覆盖入口都不留
    // （PageMetadataOverrides 已 Omit 掉 alternates）。
    alternates: alternatesFor(locale, path, availableLocales),
    openGraph: {
      ...baseMetadata.openGraph,
      ...(overrides.openGraph ?? {}),
      ...(title ? { title } : {}),
      // og:url 与 canonical 同源（规格 §6.4 要求它过 localePath）
      url: canonical,
      locale: OG_LOCALES[locale],
      images: overrides.openGraph?.images ?? [image],
    },
    twitter: {
      ...baseMetadata.twitter,
      ...(overrides.twitter ?? {}),
      ...(title ? { title } : {}),
      images: overrides.twitter?.images ?? [image],
    },
  }
}
