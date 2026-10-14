import { DEFAULT_LOCALE, LOCALES, localePath, type Locale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'
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

/**
 * 关键词在词典里是**一条分隔符连接的字符串**（`Messages` 的键值必须是 `string`）。
 * 分隔符选逗号的前提是**词条自身不含逗号**：改造前的英文四条（`Evoloop` / `made-to-order shoes` /
 * `3D printed shoes` / `shoe sizing guide`）与中文四条都逐条核查过，均不含逗号；
 * 若将来某条词本身含逗号，必须换分隔符并**同时**改两种语言的词典值，否则会多切出词条。
 */
const KEYWORD_SEPARATOR = ','

/** 词典值 → 关键词数组。`trim` 让词典里逗号后的空格只是排版；空串必须滤掉（会产出空关键词）。 */
const keywordsOf = (raw: string): string[] =>
  raw
    .split(KEYWORD_SEPARATOR)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword !== '')

/**
 * 根布局的站点级 metadata 基座，**按语言产出**：`description` / `keywords` /
 * `openGraph.locale` 都随 locale（规格 §8.5）。品牌名与 title 模板仍是单源、不随语言变化
 * （阶段 2 决策：品牌名不本地化）。
 *
 * 唯一消费点是 `src/app/[locale]/layout.tsx` 的 `generateMetadata`（裁决 R41）：
 * **noindex 页面（`global-not-found.tsx`）刻意不消费它**——404 不会被收录或分享，补上
 * description / keywords / og / twitter 收益为零，而搭进来的 `robots` 字段可能让 404 变得可索引。
 *
 * **不产出 `alternates`**：canonical 与 hreflang 一律由 `pageMetadata` 逐页给出——这里曾经写死的
 * `canonical: '/'` 会把全站 canonical 塌成一处的缺陷（规格 §8.5）。
 */
export function baseMetadataFor(locale: Locale): Metadata {
  const t = messages(locale)
  return {
    metadataBase: resolveBaseUrl(),
    title: { default: site.name, template: `%s — ${site.name}` },
    description: t['meta.description'],
    keywords: keywordsOf(t['meta.keywords']),
    authors: [{ name: site.name, url: site.url }],
    creator: site.name,
    publisher: site.name,
    openGraph: {
      type: 'website',
      url: '/',
      title: site.name,
      description: t['meta.description'],
      // 页面级一律走 pageMetadata 的逐语言 OG 图；这一条是基座自己的兜底值（裁决 R25）
      images: ['/og'],
      siteName: site.name,
      locale: OG_LOCALES[locale],
    },
    twitter: {
      card: 'summary_large_image',
      title: site.name,
      description: t['meta.description'],
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
}

/**
 * OGP 的 `og:locale` 用下划线形态（`en_US`），不是 BCP-47 的连字符形态。
 * `Record<Locale, string>` 是刻意的：`LOCALES` 加语言而这里缺一项即编译错误。
 */
const OG_LOCALES: Record<Locale, string> = { en: 'en_US', 'zh-CN': 'zh_CN' }

/** OG 图由 `/og` route handler 生成；`?locale=` 由本模块带上（proxy 不替它加前缀）。 */
const ogImage = (locale: Locale): string => `/og?locale=${locale}`

/**
 * 逐语言的 canonical 与 hreflang。
 *
 * **`locale` 的语义是「本页内容语言」**（也是 canonical 与 hreflang 的目标语言），**不是「URL 段语言」**。
 * 阶段 1 两者恒等；阶段 3 的内容回退页（URL 段是 `zh-CN`、正文是英文原文、canonical 指向英文原文）
 * 需要这个分裂：届时调用方必须传**内容语言**（`en`），否则 canonical 会指到一个并不存在的译文
 * （规格 §8.2/§8.3，C3/C4 是阻塞规则）。若某天真需要同时表达两者，那时再引入独立的
 * `canonicalLocale`——现在不加参数（YAGNI）。
 *
 * - `canonical` 永远是**该内容语言**下同一 path 的绝对 URL（规格 §8.5）；
 * - `languages` 只在 `availableLocales` 非空时输出：内容回退页不该向爬虫声明一对
 *   并不存在的译文（规格 §8.2/§8.3）；默认值 `LOCALES` 表达「该页在每种已声明语言下都存在」；
 *   任务 1–5 过渡态：默认值等价于「假设所有页面都有译文」，未译页面因此会发出假 hreflang；
 *   调用方必须以 `availableLocalesFor(...)` 收窄（任务 6）；
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
 * **`locale` 的语义是「本页内容语言」**，同时是 canonical 与 `og:url` 的目标语言（与
 * `alternatesFor` 同一语义）。阶段 3 的回退页 URL 段语言 ≠ 内容语言，调用方必须传内容语言。
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
  // 基座按**本页内容语言**取（description / keywords / 兜底 og:title 都随它）
  const base = baseMetadataFor(locale)
  return {
    ...base,
    ...overrides,
    // alternates 一律由 alternatesFor 产出。基座里曾经写死的 `canonical: '/'`
    // 会让所有页面塌到同一处（规格 §8.5 的已知缺陷），因此连覆盖入口都不留
    // （PageMetadataOverrides 已 Omit 掉 alternates）。
    alternates: alternatesFor(locale, path, availableLocales),
    openGraph: {
      ...base.openGraph,
      ...(overrides.openGraph ?? {}),
      ...(title ? { title } : {}),
      // og:url 与 canonical 同源（规格 §6.4 要求它过 localePath）
      url: canonical,
      locale: OG_LOCALES[locale],
      images: overrides.openGraph?.images ?? [image],
    },
    twitter: {
      ...base.twitter,
      ...(overrides.twitter ?? {}),
      ...(title ? { title } : {}),
      images: overrides.twitter?.images ?? [image],
    },
  }
}
