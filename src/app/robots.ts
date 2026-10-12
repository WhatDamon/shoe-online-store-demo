import type { MetadataRoute } from 'next'
import { LOCALES } from '@/i18n/locales'
import { absoluteUrl } from '@/lib/seo'

// 交易/私有路径。按语言展开成带前缀的形态（`/en/cart`…），并**额外保留无前缀的旧路径**：
// 它们仍是 308 的跳转来源，同样是「不该被索引」的入口。
const PRIVATE_PATHS = ['/cart', '/checkout', '/saved', '/orders/'] as const

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        ...LOCALES.flatMap((locale) => PRIVATE_PATHS.map((path) => `/${locale}${path}`)),
        ...PRIVATE_PATHS,
      ],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
