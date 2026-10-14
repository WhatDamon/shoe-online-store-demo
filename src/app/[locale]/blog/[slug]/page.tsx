import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LocaleLink } from '@/components/i18n/locale-link'
import { availableLocalesFor, getLocalizedPost, listPosts } from '@/lib/blog'
// 日期标签在渲染点现算：唯一来源是 `formatPostDate`（locale 必填），
// 不在内容层预先算出（那时不知道 locale）。
import { formatPostDate } from '@/lib/format'
import { absoluteUrl, pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'
import { JsonLd } from '@/components/seo/json-ld'
import { articleSchema, breadcrumbSchema } from '@/lib/structured-data'

export const dynamicParams = true

export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale: raw, slug } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  // 标题与描述随实际渲染的正文走：回退页的标题是英文原文（与正文一致，不是假翻译）。
  const localized = getLocalizedPost(slug, locale)
  if (!localized) return {}
  const { post, sourceLocale } = localized
  const description = post.description ?? `${t['blog.articleMetaLead']} ${post.title}.`
  // canonical / hreflang 一律按**本页内容语言**（`sourceLocale`）产出，不是 URL 段语言：
  // 回退页（中文 URL、英文正文）的 canonical 必须落在默认语言的同一 slug 地址上，
  // 否则会指到一份并不存在的译文（规格 §8.2/§8.3，CONTEXT.md「内容回退状态」）。
  return pageMetadata(sourceLocale, {
    title: post.title,
    description,
    path: `/blog/${post.slug}`,
    // 本页实际可用的语言 = 真有译文的语言：未译时只有默认语言，因此不发成对 hreflang。
    availableLocales: availableLocalesFor(post.slug),
    openGraph: {
      type: 'article',
      description,
      // 封面是静态资源（不经 [locale] 路由），不加前缀
      ...(post.cover ? { images: [{ url: absoluteUrl(post.cover), alt: post.title }] } : {}),
      publishedTime: `${post.date}T00:00:00Z`,
    },
  })
}

// 文章页（SSG）：/blog/[slug] 由 generateStaticParams 预渲染（与 PDP 同约定：新增/改动文章需重建）。
export default async function BlogPostPage(props: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale: raw, slug } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  const localized = getLocalizedPost(slug, locale)
  if (!localized) notFound()
  const { post, status, sourceLocale } = localized
  // 结构化数据（JSON-LD）属**内容语言**（R49 / ADR 0009 决策 4）：面包屑名必须与
  // `breadcrumbSchema` / `articleSchema` 按内容语言产出的 `item` URL 与 `inLanguage` 同语言。
  // 回退页（中文 URL、英文正文）的 `sourceLocale` 是 `en`，故 crumb 名取它的词典。已译页上
  // `sourceLocale === locale`，与 `t` 同值、零影响。页面可见文案仍用 URL 语言的 `t`。
  const contentT = messages(sourceLocale)

  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:pt-14">
      {/* 结构化数据的 `locale` 是**内容语言**（`sourceLocale`），不是 URL 段语言：回退页（中文 URL、
        英文正文）的 `@id` / URL 前缀与 `inLanguage` 必须与 canonical 同源（规格 §8.3，
        `structured-data.ts` 的模块注释）。面包屑的 `name` 同取 `sourceLocale` 的词典（`contentT`），
        否则会发出「中文 crumb 名 + `/en/...` 地址」。已译页上 `sourceLocale === locale`，零影响。 */}
      <JsonLd
        data={breadcrumbSchema(sourceLocale, [
          { name: contentT['nav.home'], path: '/' },
          { name: contentT['blog.sectionName'], path: '/blog' },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />
      <JsonLd
        data={articleSchema(sourceLocale, {
          slug: post.slug,
          title: post.title,
          description: post.description ?? `${t['blog.articleMetaLead']} ${post.title}.`,
          date: post.date,
          image: post.cover,
        })}
      />
      <LocaleLink
        href="/blog"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
      >
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
        {t['blog.allPosts']}
      </LocaleLink>

      {/* 回退提示条：正文是默认语言原文，显式告诉读者，而不是让中文页面静默地显示英文。 */}
      {status === 'fallback' ? (
        <p className="mt-6 rounded-xl border border-neutral-200 bg-surface px-4 py-3 text-sm text-neutral-600">
          {t['blog.fallbackNotice']}
        </p>
      ) : null}

      {post.cover ? (
        <div className="relative mt-6 h-56 w-full overflow-hidden rounded-2xl border border-neutral-200/80 sm:h-72">
          <Image
            src={post.cover}
            alt=""
            fill
            sizes="(min-width:768px) 48rem, 100vw"
            className="object-cover"
          />
        </div>
      ) : null}

      <header className="mt-8">
        <p className="text-sm text-neutral-500">{formatPostDate(post.date, locale)}</p>
        <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {post.title}
        </h1>
      </header>

      <div className="article-body mt-8">
        <Markdown remarkPlugins={[remarkGfm]}>{post.content}</Markdown>
      </div>

      {post.tags.length > 0 ? (
        <p className="mt-10 border-t border-neutral-200 pt-5 text-xs text-neutral-500">
          {post.tags.map((tag) => `#${tag}`).join('  ')}
        </p>
      ) : null}
    </article>
  )
}
