import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { BlogPost } from '@/lib/blog'
import type { LocalizedPost } from '@/i18n/content'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { itemListSchema, productSchema } from '@/lib/structured-data'
import type { ProductView } from '@/domain/product'
import ErrorBoundary from './error'
import NotFound from './not-found'

/**
 * 批次 D 抽取（landing / blog / 错误边界与 404 / 结构化数据标签）的**永久回归网**。
 *
 * 期望值一律写**字面量**（不走词典取值）：词典被改一个字，这里就红。逐字一致的基线证据
 * （BASE 与当前两版页面的可执行对照）在 SDD 报告里，本文件只负责把「今天这批页面渲染/输出
 * 的整串」钉住，防止后续改动静默改变文案。
 *
 * 状态页的断言用 `textContent` 整串相等，而不是 `getByText` / `toHaveTextContent`：后者会
 * 归一化空白（任务 8 的 `((US 4.5–12.5))` 双括号就是被归一化掩盖的回归）。
 */

// 落地页的区块组件与 blog 内容层都由本文件的被测对象之外的模块提供：
// - 区块组件：本文件只验证 landing 页自己的元信息与结构化数据（区块各有自己的测试），
//   `CollectionCards` / `FeaturedGrid` 还是 async 组件，RTL 无法直接渲染；
// - blog 内容层：正文与 frontmatter 是内容资产（阶段 3 才本地化），用固定 fixture 才能钉住
//   界面外壳的拼装（标签、无 description 时的元信息兜底句、空态）。
vi.mock('@/components/marketing/hero', () => ({ Hero: () => null }))
vi.mock('@/components/marketing/promise-strip', () => ({ PromiseStrip: () => null }))
vi.mock('@/components/marketing/collection-cards', () => ({ CollectionCards: () => null }))
vi.mock('@/components/marketing/featured-grid', () => ({ FeaturedGrid: () => null }))
vi.mock('@/components/marketing/story-section', () => ({ StorySection: () => null }))
vi.mock('@/components/marketing/faq-section', () => ({ FaqSection: () => null }))

const content = vi.hoisted(() => ({
  posts: [] as BlogPost[],
  post: null as BlogPost | null,
}))

vi.mock('@/lib/blog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/blog')>()),
  listPosts: () => content.posts,
  getPost: () => content.post,
  // 夹具内容全部是 `en` 原文，且本文件只在 `'en'` 语境下渲染这些页面，所以写
  // `translated` / `sourceLocale: 'en'` 与真实机制同义（不是「用 mock 盖住回退」）。
  // 回退行为由 `src/lib/blog.test.ts` 的夹具测试与生产抽查负责，本文件不测它。
  getLocalizedPost: (): LocalizedPost<BlogPost> | null =>
    content.post ? { post: content.post, status: 'translated', sourceLocale: 'en' } : null,
  listLocalizedPosts: (): LocalizedPost<BlogPost>[] =>
    content.posts.map((post) => ({ post, status: 'translated', sourceLocale: 'en' })),
}))

import HomePage, { generateMetadata as landingMetadata } from './(landing)/page'
import BlogPage, { generateMetadata as blogMetadata } from './blog/page'
import BlogPostPage, { generateMetadata as postMetadata } from './blog/[slug]/page'

/** 状态页（error / 404）都走 StatusShell → SiteShell → AppBar，故需要 Wishlist Provider。 */
const renderStatusPage = (node: ReactElement) => render(<WishlistProvider>{node}</WishlistProvider>)

/** 取出页面里的 JSON-LD 节点（`@type` 匹配），解析回对象便于逐字段断言。 */
function jsonLd(type: string): Record<string, unknown> {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
  for (const script of scripts) {
    const data = JSON.parse(script.textContent ?? 'null') as Record<string, unknown>
    if (data?.['@type'] === type) return data
  }
  throw new Error(`页面里没有 @type=${type} 的 JSON-LD`)
}

/** 去掉 `<script>`（JSON-LD 的内联文本也会进 `textContent`）后的可见文本。 */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script').forEach((script) => script.remove())
  return clone.textContent ?? ''
}

const POST: BlogPost = {
  slug: 'finding-your-size',
  title: 'Finding your size',
  date: '2026-09-06',
  description: 'How we size a pair.',
  cover: null,
  tags: ['Sizing', 'Guide'],
  content: 'Body text.',
}

const PRODUCT: ProductView = {
  id: 'evo-01',
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'Unisex · 5 colorways',
  description: 'A unisex everyday sneaker offered in 5 colorways.',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [40, 41],
  features: [],
  fitNotes: 'Runs true to size.',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: false },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  colors: [],
  images: [],
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [
    { value: 40, label: 'US 7' },
    { value: 41, label: 'US 8' },
  ],
}

describe('落地页（(landing)/page.tsx）', () => {
  it('metadata 标题是硬编码原文（不带句末句号，与视觉标题不同串）', async () => {
    const meta = await landingMetadata({ params: Promise.resolve({ locale: 'en' }) })
    expect(meta.title).toBe('Casual shoes, printed to order in your size')
  })

  it('webPageSchema 的 name / description 是硬编码原文', async () => {
    render(await HomePage({ params: Promise.resolve({ locale: 'en' }) }))
    const page = jsonLd('WebPage')
    expect(page.name).toBe('Evoloop — casual shoes made to order')
    expect(page.description).toBe(
      'Explore Evoloop casual shoes, millimetre-based sizing, digital manufacturing, and the studio story.',
    )
  })
})

describe('博客索引（blog/page.tsx）', () => {
  beforeEach(() => {
    content.posts = [
      POST,
      { ...POST, slug: 'other', title: 'Second note', cover: '/covers/x.webp' },
    ]
  })

  it('metadata 标题与导航共用 Blog，描述是索引页自己的那句', async () => {
    const meta = await blogMetadata({ params: Promise.resolve({ locale: 'en' }) })
    expect(meta.title).toBe('Blog')
    expect(meta.description).toBe('Stories, guides and notes from the Evoloop studio.')
  })

  it('kicker / 标题 / 副标题 / 标签 / 无封面替图的可及名逐字渲染', async () => {
    // 博客索引页只出内容，外壳（AppBar / Footer / main）由 blog/layout.tsx 的 SiteShell 提供，
    // 故直接对渲染容器取整串。
    const { container } = render(await BlogPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(container.querySelector('p')?.textContent).toBe('Journal')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Blog')
    // 标签拼装：`#标签` 以两个空格连接（骨架留在页面里）
    expect(visibleText(container)).toContain('#Sizing  #Guide')
    // 无封面文章的替图可及名后缀（封面图存在的那篇走 <Image alt="">）
    expect(visibleText(container)).toContain('Finding your size cover')
  })

  it('CollectionPage 的 name / description 是硬编码原文', async () => {
    render(await BlogPage({ params: Promise.resolve({ locale: 'en' }) }))
    const page = jsonLd('CollectionPage')
    expect(page.name).toBe('Evoloop Journal')
    expect(page.description).toBe('Stories and practical guides from the Evoloop studio.')
  })

  it('副标题与空态整串（空态是 posts 为空时的那句）', async () => {
    content.posts = []
    const { container } = render(await BlogPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(visibleText(container)).toBe(
      'JournalBlog' +
        'Stories, guides and notes from the studio — from how we size shoes to what happens inside the workshop.' +
        'No articles yet — check back soon.',
    )
  })
})

describe('博客文章页（blog/[slug]/page.tsx）', () => {
  beforeEach(() => {
    content.post = POST
  })

  it('返回链接与面包屑的名字逐字', async () => {
    render(await BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: POST.slug }) }))
    expect(screen.getByRole('link', { name: 'All posts' }).textContent).toBe('All posts')
    const crumbs = jsonLd('BreadcrumbList').itemListElement as { name: string }[]
    expect(crumbs.map((crumb) => crumb.name)).toEqual(['Home', 'Journal', 'Finding your size'])
  })

  it('有 description 时 articleSchema 用原文', async () => {
    render(await BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: POST.slug }) }))
    expect(jsonLd('Article').description).toBe('How we size a pair.')
  })

  it('缺 description 时兜底句是「句首 + 标题 + 句号」的整串', async () => {
    content.post = { ...POST, description: null }
    const meta = await postMetadata({ params: Promise.resolve({ locale: 'en', slug: POST.slug }) })
    expect(meta.description).toBe('An Evoloop Journal article: Finding your size.')
    render(await BlogPostPage({ params: Promise.resolve({ locale: 'en', slug: POST.slug }) }))
    expect(jsonLd('Article').description).toBe('An Evoloop Journal article: Finding your size.')
  })
})

describe('错误边界（error.tsx）', () => {
  it('标题 / 说明 / 两个 CTA 整串渲染', () => {
    renderStatusPage(<ErrorBoundary reset={() => {}} />)
    expect(screen.getByRole('main').textContent).toBe(
      'Evoloop' +
        'Something went wrong on our end' +
        'Please give it one more try — most hiccups clear right up.' +
        'Try again' +
        'Browse the shop',
    )
  })
})

describe('404（not-found.tsx）', () => {
  it('复用 notFound.* 三处文案，整串渲染', () => {
    renderStatusPage(<NotFound />)
    expect(screen.getByRole('main').textContent).toBe(
      'Evoloop' +
        "We couldn't find that page" +
        'It may have moved, or the link may be out of date. The shop is still open, though.' +
        'Browse the shop',
    )
    expect(screen.getByRole('link', { name: 'Browse the shop' })).toHaveAttribute(
      'href',
      '/en/shop',
    )
  })
})

describe('结构化数据的标签（productSchema / itemListSchema）', () => {
  it('additionalProperty 的 name / value 是词典取值，尺码标签仍是目录数据', () => {
    const product = productSchema('en', PRODUCT)
    expect(product.additionalProperty).toEqual([
      { '@type': 'PropertyValue', name: 'Available sizes', value: 'US 7, US 8' },
      { '@type': 'PropertyValue', name: 'Fit', value: 'Runs true to size.' },
      {
        '@type': 'PropertyValue',
        name: 'Sales status',
        value: 'Demo catalog; checkout is not live yet.',
      },
    ])
  })

  it('ItemList 的名字是「品牌名 + 词典里的后半句」', () => {
    expect(itemListSchema('en', [PRODUCT]).name).toBe('Evoloop shoe collection')
  })
})
