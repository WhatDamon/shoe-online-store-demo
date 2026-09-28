import type { MetadataRoute } from 'next'
import { catalog } from '@/server/catalog/adapter'
import { listPosts } from '@/lib/blog'
import { absoluteUrl } from '@/lib/seo'

const SITE_UPDATED = '2026-09-23'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, posts] = await Promise.all([
    catalog().getProducts(),
    Promise.resolve(listPosts()),
  ])

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: SITE_UPDATED, changeFrequency: 'weekly', priority: 1 },
    {
      url: absoluteUrl('/shop'),
      lastModified: SITE_UPDATED,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: absoluteUrl('/blog'),
      lastModified: SITE_UPDATED,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ]

  const productRoutes: MetadataRoute.Sitemap = products.map((product) => ({
    url: absoluteUrl(`/product/${product.handle}`),
    lastModified: product.createdAt,
    changeFrequency: 'weekly',
    priority: 0.8,
    ...(product.images?.length
      ? { images: product.images.map((image) => absoluteUrl(image)) }
      : {}),
  }))

  const articleRoutes: MetadataRoute.Sitemap = posts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: post.date,
    changeFrequency: 'monthly',
    priority: 0.6,
    ...(post.cover ? { images: [absoluteUrl(post.cover)] } : {}),
  }))

  return [...staticRoutes, ...productRoutes, ...articleRoutes]
}
