import type { ProductView } from '@/domain/product'
import { absoluteUrl } from './seo'
import { site } from './site'

export type JsonLdObject = Record<string, unknown>

export const organizationSchema = (): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': absoluteUrl('/#organization'),
  name: site.name,
  url: absoluteUrl('/'),
  description: site.description,
  logo: absoluteUrl('/og'),
  sameAs: ['https://github.com/WhatDamon/shoe-online-store-demo'],
})

export const websiteSchema = (): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': absoluteUrl('/#website'),
  name: site.name,
  url: absoluteUrl('/'),
  description: site.description,
  publisher: { '@id': absoluteUrl('/#organization') },
  potentialAction: {
    '@type': 'SearchAction',
    target: `${absoluteUrl('/shop')}?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
})

export const webPageSchema = (input: {
  name: string
  description: string
  path: string
  type?: 'WebPage' | 'CollectionPage' | 'AboutPage'
}): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': input.type ?? 'WebPage',
  '@id': absoluteUrl(`${input.path}#webpage`),
  name: input.name,
  description: input.description,
  url: absoluteUrl(input.path),
  isPartOf: { '@id': absoluteUrl('/#website') },
})

export const breadcrumbSchema = (items: { name: string; path: string }[]): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
})

export const productSchema = (product: ProductView): JsonLdObject => {
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
    '@id': absoluteUrl(`/product/${product.handle}#product`),
    name: product.title,
    sku: product.handle.toUpperCase(),
    description: product.description,
    category: product.productType,
    ...(images.length > 0 ? { image: images } : {}),
    ...(product.colors?.length
      ? { color: product.colors.map((color) => color.name).join(', ') }
      : {}),
    brand: { '@type': 'Brand', name: site.name },
    manufacturer: { '@id': absoluteUrl('/#organization') },
    additionalProperty: properties,
  }
}

export const itemListSchema = (products: ProductView[]): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: `${site.name} shoe collection`,
  numberOfItems: products.length,
  itemListElement: products.map((product, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: absoluteUrl(`/product/${product.handle}`),
    name: product.title,
  })),
})

export const articleSchema = (input: {
  slug: string
  title: string
  description: string
  date: string
  image?: string | null
}): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  '@id': absoluteUrl(`/blog/${input.slug}#article`),
  headline: input.title,
  description: input.description,
  datePublished: `${input.date}T00:00:00Z`,
  dateModified: `${input.date}T00:00:00Z`,
  mainEntityOfPage: absoluteUrl(`/blog/${input.slug}`),
  author: { '@id': absoluteUrl('/#organization') },
  publisher: { '@id': absoluteUrl('/#organization') },
  ...(input.image ? { image: absoluteUrl(input.image) } : {}),
})

export const faqSchema = (items: { question: string; answer: string }[]): JsonLdObject => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
})
