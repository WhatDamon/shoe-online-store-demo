import type { MetadataRoute } from 'next'
import { catalog } from '@/server/catalog/adapter'
import { listPosts } from '@/lib/blog'
import { LOCALES, localePath } from '@/i18n/locales'
import { absoluteUrl, alternatesFor } from '@/lib/seo'

const SITE_UPDATED = '2026-09-23'

type SitemapEntry = MetadataRoute.Sitemap[number]

/**
 * 按语言逐条展开：每条路径在每种已声明语言下都是独立 URL（canonical 自指），
 * 并带上成对的 hreflang（含 x-default）。
 *
 * 「译文是否存在」的资格判定（规格 §8.3：回退页不进 sitemap、不输出 hreflang）属于内容层，
 * 阶段 3 由 `src/i18n/content.ts` 提供；届时把该页可用的语言集合作为第三参数传进来即可
 * （`alternatesFor(locale, path, availableLocales)` 就是那处接缝）。阶段 1 只有 en，
 * 每种页面的可用语言就是 `LOCALES`。
 *
 * 图片是静态资源（不经 `[locale]` 路由），因此不加前缀。
 */
const localized = (path: string, entry: Omit<SitemapEntry, 'url' | 'alternates'>): SitemapEntry[] =>
  LOCALES.map((locale) => ({
    url: absoluteUrl(localePath(locale, path)),
    alternates: alternatesFor(locale, path),
    ...entry,
  }))

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, posts] = await Promise.all([
    catalog().getProducts(),
    Promise.resolve(listPosts()),
  ])

  return [
    ...localized('/', { lastModified: SITE_UPDATED, changeFrequency: 'weekly', priority: 1 }),
    ...localized('/shop', { lastModified: SITE_UPDATED, changeFrequency: 'daily', priority: 0.9 }),
    ...localized('/blog', { lastModified: SITE_UPDATED, changeFrequency: 'weekly', priority: 0.7 }),
    ...products.flatMap((product) =>
      localized(`/product/${product.handle}`, {
        lastModified: product.createdAt,
        changeFrequency: 'weekly',
        priority: 0.8,
        ...(product.images?.length
          ? { images: product.images.map((image) => absoluteUrl(image)) }
          : {}),
      }),
    ),
    ...posts.flatMap((post) =>
      localized(`/blog/${post.slug}`, {
        lastModified: post.date,
        changeFrequency: 'monthly',
        priority: 0.6,
        ...(post.cover ? { images: [absoluteUrl(post.cover)] } : {}),
      }),
    ),
  ]
}
