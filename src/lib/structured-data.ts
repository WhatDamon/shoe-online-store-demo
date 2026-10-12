import type { ProductView } from '@/domain/product'
import { localePath, type Locale } from '@/i18n/locales'
import { absoluteUrl } from './seo'
import { site } from './site'

export type JsonLdObject = Record<string, unknown>

/**
 * 结构化数据：URL 一律带 locale 前缀（与 canonical 同源，规格 §6.4/§8.4），
 * `inLanguage` 用**内容实际语言**（规格 §8.5）。
 *
 * ## `locale` 参数的语义（改这里之前先读完）
 *
 * 本文件所有构造器的 `locale` 都是**内容语言**，不是「URL 段语言」：文档级节点的 URL 前缀与
 * `inLanguage` 都由它决定。阶段 1 两者恒等；阶段 3 的回退页（URL 段是 `zh-CN`、正文是英文原文）
 * 必须传**内容语言**（`en`），`inLanguage` 才会是实际内容语言（规格 §8.3/§8.5）。
 * 若某天真需要同时表达「页面所在 URL」与「内容语言」，那时再引入独立参数——现在不加（YAGNI）。
 *
 * ## `@id` 政策（改这里之前先读完）
 *
 * `@id` 是**图节点身份**，被同一页面里的其它节点引用（`publisher` / `manufacturer` /
 * `author` / `isPartOf`）。因此它不能「为了统一加前缀」而随语言漂移：
 *
 * - **站点级实体（Organization）身份与语言无关**：一个组织只有一个身份。若按语言前缀，
 *   同一个组织会在多语言站点上被拆成互不相关的节点，跨页引用（manufacturer / author）
 *   也再指不回同一个实体。故它的 `@id`、`url`、`logo` 都保持与语言无关；
 * - **文档级节点（WebSite / WebPage / Article / Product）身份逐语言**：每个语言版本是
 *   独立文档（`url`、`inLanguage`、搜索入口都不同），共用一个 `@id` 会让两个语言版本
 *   声明成同一个节点。
 *
 * 后果（明确的代价）：多语言站点上 Organization 只有一个节点、其 `url` 指向站点根；
 * 而 WebSite 会有每个语言一份，各自 `isPartOf` 关系在本页内可解析。
 *
 * `inLanguage` 只加在 schema.org 支持该属性的节点上（WebSite / WebPage / Article /
 * FAQPage 都是 `CreativeWork` 子类）。`Product`、`ItemList`、`BreadcrumbList`、
 * `Organization` 没有这个属性，不硬造。
 */

/** 站点级实体身份：全站唯一、与语言无关（见上文政策）。 */
const organizationId = (): string => absoluteUrl('/#organization')

/** WebSite 是逐语言的节点：搜索入口与 `inLanguage` 都随语言变化。 */
const websiteId = (locale: Locale): string => absoluteUrl(`${localePath(locale, '/')}#website`)

export const organizationSchema = (): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': organizationId(),
  name: site.name,
  url: absoluteUrl('/'),
  description: site.description,
  logo: absoluteUrl('/og'),
  sameAs: ['https://github.com/WhatDamon/shoe-online-store-demo'],
})

export const websiteSchema = (locale: Locale): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': websiteId(locale),
  name: site.name,
  url: absoluteUrl(localePath(locale, '/')),
  description: site.description,
  inLanguage: locale,
  publisher: { '@id': organizationId() },
  potentialAction: {
    '@type': 'SearchAction',
    target: `${absoluteUrl(localePath(locale, '/shop'))}?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
})

export const webPageSchema = (
  locale: Locale,
  input: {
    name: string
    description: string
    path: string
    type?: 'WebPage' | 'CollectionPage' | 'AboutPage'
  },
): JsonLdObject => {
  const path = localePath(locale, input.path)
  return {
    '@context': 'https://schema.org',
    '@type': input.type ?? 'WebPage',
    '@id': `${absoluteUrl(path)}#webpage`,
    name: input.name,
    description: input.description,
    url: absoluteUrl(path),
    inLanguage: locale,
    isPartOf: { '@id': websiteId(locale) },
  }
}

export const breadcrumbSchema = (
  locale: Locale,
  items: { name: string; path: string }[],
): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: absoluteUrl(localePath(locale, item.path)),
  })),
})

export const productSchema = (locale: Locale, product: ProductView): JsonLdObject => {
  // 商品图是静态资源（不经 [locale] 路由），不加前缀。
  const images = (product.images ?? []).map((image) => absoluteUrl(image))
  const properties = [
    {
      '@type': 'PropertyValue',
      name: 'Available sizes',
      value: product.sizeOptions.map((s) => s.label).join(', '),
    },
    { '@type': 'PropertyValue', name: 'Fit', value: product.fitNotes },
    {
      '@type': 'PropertyValue',
      name: 'Sales status',
      value: 'Demo catalog; checkout is not live yet.',
    },
  ]

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${absoluteUrl(localePath(locale, `/product/${product.handle}`))}#product`,
    name: product.title,
    sku: product.handle.toUpperCase(),
    description: product.description,
    category: product.productType,
    ...(images.length > 0 ? { image: images } : {}),
    ...(product.colors?.length
      ? { color: product.colors.map((color) => color.name).join(', ') }
      : {}),
    brand: { '@type': 'Brand', name: site.name },
    manufacturer: { '@id': organizationId() },
    additionalProperty: properties,
  }
}

export const itemListSchema = (locale: Locale, products: ProductView[]): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: `${site.name} shoe collection`,
  numberOfItems: products.length,
  itemListElement: products.map((product, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: absoluteUrl(localePath(locale, `/product/${product.handle}`)),
    name: product.title,
  })),
})

export const articleSchema = (
  locale: Locale,
  input: {
    slug: string
    title: string
    description: string
    date: string
    image?: string | null
  },
): JsonLdObject => {
  const path = localePath(locale, `/blog/${input.slug}`)
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${absoluteUrl(path)}#article`,
    headline: input.title,
    description: input.description,
    datePublished: `${input.date}T00:00:00Z`,
    dateModified: `${input.date}T00:00:00Z`,
    inLanguage: locale,
    mainEntityOfPage: absoluteUrl(path),
    author: { '@id': organizationId() },
    publisher: { '@id': organizationId() },
    // 封面是静态资源（不经 [locale] 路由），不加前缀。
    ...(input.image ? { image: absoluteUrl(input.image) } : {}),
  }
}

export const faqSchema = (
  locale: Locale,
  items: { question: string; answer: string }[],
): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  inLanguage: locale,
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
})
