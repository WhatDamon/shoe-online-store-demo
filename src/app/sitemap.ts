import type { MetadataRoute } from 'next'
import { catalog } from '@/server/catalog/adapter'
import { availableLocalesFor, listPosts } from '@/lib/blog'
import { LOCALES, localePath, type Locale } from '@/i18n/locales'
import { absoluteUrl, alternatesFor } from '@/lib/seo'

const SITE_UPDATED = '2026-09-23'

type SitemapEntry = MetadataRoute.Sitemap[number]

/**
 * 按**该路径实际可用的语言**逐条展开：每种可用语言一份独立 URL（canonical 自指），
 * 并带上成对的 hreflang（含 x-default）。**没有译文的语言不产出条目**——「译文是否存在」的
 * 资格判定（规格 §8.3）属于内容层，由 `availableLocalesFor`（src/lib/blog.ts）提供；
 * 回退页进 sitemap 等于向搜索引擎声明一个并不存在的中文页，比不收窄更伤。
 *
 * `availableLocales` 缺省是 `LOCALES`，语义是「该路径在每种已声明语言下都存在」：静态页的
 * 内容就是界面文案，两种语言都有，故用缺省；**内容页必须由调用方逐页收窄**（见下方两段）。
 *
 * 图片是静态资源（不经 `[locale]` 路由），因此不加前缀。
 */
const localized = (
  path: string,
  entry: Omit<SitemapEntry, 'url' | 'alternates'>,
  availableLocales: readonly Locale[] = LOCALES,
): SitemapEntry[] =>
  availableLocales.map((locale) => ({
    url: absoluteUrl(localePath(locale, path)),
    alternates: alternatesFor(locale, path, availableLocales),
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
    // 商品段：阶段 2 的**有意口径**——商品界面文案已中文化，但商品文案（标题/描述/特性）
    // 属阶段 3，故 /zh-CN/product/<handle> 是回退页，只留默认语言 `'en'`（即 DEFAULT_LOCALE）：
    // 不发 zh-CN hreflang，也不产出 /zh-CN/product/<handle> 条目。
    // 代价（已接受）：阶段 2 的 zh-CN sitemap 只有 3 个静态 URL（`/zh-CN`、`/zh-CN/shop`、
    // `/zh-CN/blog`）——宁可少收录，也不发假 alternate。
    // 阶段 3 商品译文落地后，改为与文章段同一写法：按实际可用性判断。
    ...products.flatMap((product) =>
      localized(
        `/product/${product.handle}`,
        {
          lastModified: product.createdAt,
          changeFrequency: 'weekly',
          priority: 0.8,
          ...(product.images?.length
            ? { images: product.images.map((image) => absoluteUrl(image)) }
            : {}),
        },
        ['en'],
      ),
    ),
    // 文章段：逐篇按真实存在的译文收窄（译文是 `content/blog/<locale>/<slug>.md`）。
    ...posts.flatMap((post) =>
      localized(
        `/blog/${post.slug}`,
        {
          lastModified: post.date,
          changeFrequency: 'monthly',
          priority: 0.6,
          ...(post.cover ? { images: [absoluteUrl(post.cover)] } : {}),
        },
        availableLocalesFor(post.slug),
      ),
    ),
  ]
}
