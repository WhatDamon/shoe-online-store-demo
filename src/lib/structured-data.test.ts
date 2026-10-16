import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProductView } from '@/domain/product'
import { site } from './site'
import {
  articleSchema,
  breadcrumbSchema,
  faqSchema,
  itemListSchema,
  organizationSchema,
  productSchema,
  webPageSchema,
  websiteSchema,
} from './structured-data'

const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'

// 绝对 URL 的基址由 absoluteUrl 每次调用重读 env：钉到正式域后期望值才是部署形态。
beforeEach(() => {
  process.env[ENV_KEY] = site.url
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

const product: ProductView = {
  id: 'evo-01',
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'Unisex · 5 colorways',
  description: 'A unisex everyday sneaker offered in 5 colorways.',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [40, 41, 42],
  features: [],
  fitNotes: 'Runs true to size.',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: false },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  colors: [],
  images: ['/products/dc-1001/a.webp'],
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [
    { value: 40, label: 'US 7' },
    { value: 41, label: 'US 8' },
    { value: 42, label: 'US 8.5' },
  ],
}

/** 收集 JSON-LD 里所有以站点域开头的 URL 字符串（含 `@id` 里的 `…#fragment`）。 */
function siteUrls(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith(site.url) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(siteUrls)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(siteUrls)
  }
  return []
}

/**
 * 不经 `[locale]` 路由的图片资源（商品图 / 文章封面）与 `/og` 图端点：
 * 它们是静态/独立资源，刻意不加前缀。
 */
const ASSET_PREFIXES = [`${site.url}/products/`, `${site.url}/blog/covers/`, `${site.url}/og`]

describe('文档级节点的 URL 逐语言', () => {
  it('WebPage 的 url/@id/isPartOf 都带 locale 前缀', () => {
    const schema = webPageSchema('en', {
      name: 'Shop Evoloop shoes',
      description: 'Browse styles.',
      path: '/shop',
      type: 'CollectionPage',
    })
    expect(schema.url).toBe(`${site.url}/en/shop`)
    expect(schema['@id']).toBe(`${site.url}/en/shop#webpage`)
    expect(schema.isPartOf).toEqual({ '@id': `${site.url}/en#website` })
    expect(schema.inLanguage).toBe('en')
  })

  it('Article 的 @id/mainEntityOfPage 带前缀，封面图不带', () => {
    const schema = articleSchema('en', {
      slug: 'finding-your-evoloop-size',
      title: 'Finding your Evoloop size',
      description: 'How we size.',
      date: '2026-09-07',
      image: '/blog/covers/size.webp',
    })
    expect(schema['@id']).toBe(`${site.url}/en/blog/finding-your-evoloop-size#article`)
    expect(schema.mainEntityOfPage).toBe(`${site.url}/en/blog/finding-your-evoloop-size`)
    expect(schema.image).toBe(`${site.url}/blog/covers/size.webp`)
    expect(schema.inLanguage).toBe('en')
  })

  it('Product 的 @id 带前缀，商品图不带', () => {
    const schema = productSchema('en', product)
    expect(schema['@id']).toBe(`${site.url}/en/product/dc-1001#product`)
    expect(schema.image).toEqual([`${site.url}/products/dc-1001/a.webp`])
  })

  it('ItemList 与面包屑的商品/页面链接带前缀', () => {
    const list = itemListSchema('en', [product])
    expect(list.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        url: `${site.url}/en/product/dc-1001`,
        name: 'Urban Bloom',
      },
    ])
    const crumbs = breadcrumbSchema('en', [
      { name: 'Home', path: '/' },
      { name: 'Journal', path: '/blog' },
    ])
    expect(crumbs.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${site.url}/en` },
      { '@type': 'ListItem', position: 2, name: 'Journal', item: `${site.url}/en/blog` },
    ])
  })

  it('WebSite 的 url/搜索入口/@id 逐语言', () => {
    const schema = websiteSchema('en')
    expect(schema.url).toBe(`${site.url}/en`)
    expect(schema['@id']).toBe(`${site.url}/en#website`)
    expect(schema.inLanguage).toBe('en')
    expect((schema.potentialAction as { target: string }).target).toBe(
      `${site.url}/en/shop?q={search_term_string}`,
    )
  })

  it('所有节点里的页面 URL 都带 locale 前缀（静态资源与站点级身份除外）', () => {
    const nodes = [
      websiteSchema('en'),
      webPageSchema('en', { name: 'X', description: 'Y', path: '/shop' }),
      articleSchema('en', {
        slug: 's',
        title: 'T',
        description: 'D',
        date: '2026-09-07',
        image: '/blog/covers/s.webp',
      }),
      productSchema('en', product),
      itemListSchema('en', [product]),
      breadcrumbSchema('en', [{ name: 'Home', path: '/' }]),
    ]
    for (const node of nodes) {
      const urls = siteUrls(node)
      expect(urls.length).toBeGreaterThan(0)
      for (const url of urls) {
        const exempt = url.includes('/#') || ASSET_PREFIXES.some((prefix) => url.startsWith(prefix))
        expect(
          exempt || url.startsWith(`${site.url}/en`),
          `${url} 既不带 locale 前缀、也不是站点级身份或静态资源`,
        ).toBe(true)
      }
    }
  })
})

describe('@id 的稳定性（被引用的图节点身份）', () => {
  it('Organization 身份与语言无关：不随 locale 漂移', () => {
    expect(organizationSchema()['@id']).toBe(`${site.url}/#organization`)
  })

  it('跨节点的引用指向同一个 Organization 身份', () => {
    const organizationId = organizationSchema()['@id']
    expect((websiteSchema('en').publisher as { '@id': string })['@id']).toBe(organizationId)
    expect((productSchema('en', product).manufacturer as { '@id': string })['@id']).toBe(
      organizationId,
    )
    const article = articleSchema('en', {
      slug: 's',
      title: 'T',
      description: 'D',
      date: '2026-09-07',
    })
    expect((article.author as { '@id': string })['@id']).toBe(organizationId)
    expect((article.publisher as { '@id': string })['@id']).toBe(organizationId)
  })

  it('文档级节点身份逐语言：页面的 isPartOf 指向本语言的 WebSite，而不是组织身份', () => {
    const page = webPageSchema('en', { name: 'X', description: 'Y', path: '/shop' })
    expect(page.isPartOf).toEqual({ '@id': websiteSchema('en')['@id'] })
    expect(page.isPartOf).not.toEqual({ '@id': organizationSchema()['@id'] })
  })
})

describe('inLanguage 用内容实际语言', () => {
  it('CreativeWork 类节点带 inLanguage', () => {
    expect(websiteSchema('en').inLanguage).toBe('en')
    expect(webPageSchema('en', { name: 'X', description: 'Y', path: '/' }).inLanguage).toBe('en')
    expect(faqSchema('en', [{ question: 'Q', answer: 'A' }]).inLanguage).toBe('en')
  })

  it('没有该属性的节点不硬造 inLanguage', () => {
    expect(productSchema('en', product).inLanguage).toBeUndefined()
    expect(itemListSchema('en', [product]).inLanguage).toBeUndefined()
    expect(breadcrumbSchema('en', [{ name: 'Home', path: '/' }]).inLanguage).toBeUndefined()
    expect(organizationSchema().inLanguage).toBeUndefined()
  })
})
