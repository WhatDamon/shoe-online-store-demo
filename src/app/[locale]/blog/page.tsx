import type { Metadata } from 'next'
import Image from 'next/image'
import { LocaleLink } from '@/components/i18n/locale-link'
import { listLocalizedPosts, type BlogPost } from '@/lib/blog'
// 日期标签在渲染点现算：唯一来源是 `formatPostDate`（locale 必填），
// 不在内容层预先算出（那时不知道 locale）。
import { formatPostDate } from '@/lib/format'
import { pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'
import { JsonLd } from '@/components/seo/json-ld'
import { webPageSchema } from '@/lib/structured-data'

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  return pageMetadata(locale, {
    // 页面名与导航里的 `Blog` 是同一个表面名，故共用 `nav.blog`（同值同语境，同 /shop 的 nav.shop）。
    title: t['nav.blog'],
    description: t['blog.meta.description'],
    path: '/blog',
  })
}

// 封面占位：无封面文章的品牌渐变替图（克制：低饱和径向光晕 + 对角微光，跟随主题令牌）。
function CoverPlaceholder({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      className="h-full w-full bg-surface"
      style={{
        backgroundImage:
          'radial-gradient(120% 150% at 12% 8%, color-mix(in oklab, var(--brand) 14%, transparent), transparent 46%), linear-gradient(135deg, color-mix(in oklab, var(--ink) 5%, transparent), transparent 62%)',
      }}
    >
      <span className="sr-only">{label}</span>
    </div>
  )
}

function CoverSlot({ post, label }: { post: BlogPost; label: string }) {
  return (
    <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-2xl border border-neutral-200/80 sm:h-32 sm:w-48">
      {post.cover ? (
        <Image
          src={post.cover}
          alt=""
          fill
          sizes="(min-width:640px) 12rem, 100vw"
          className="object-cover"
        />
      ) : (
        <CoverPlaceholder label={label} />
      )}
    </div>
  )
}

export default async function BlogPage(props: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  const posts = listLocalizedPosts(locale)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:pt-14">
      <JsonLd
        data={webPageSchema(locale, {
          name: t['blog.schema.name'],
          description: t['blog.schema.description'],
          path: '/blog',
          type: 'CollectionPage',
        })}
      />
      <p className="text-sm font-medium text-brand">{t['blog.sectionName']}</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {t['nav.blog']}
      </h1>
      <p className="mt-3 text-[15px] leading-7 text-neutral-600">{t['blog.subtitle']}</p>

      {posts.length === 0 ? (
        <p className="mt-10 text-neutral-600">{t['blog.empty']}</p>
      ) : (
        <div className="mt-10 flex flex-col divide-y divide-neutral-200">
          {posts.map(({ post, status }) => (
            <LocaleLink
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group flex flex-col gap-4 py-7 sm:flex-row sm:gap-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-400"
            >
              <CoverSlot post={post} label={`${post.title} ${t['blog.coverLabel']}`} />
              <div className="flex min-w-0 flex-col">
                <p className="text-sm text-neutral-500">{formatPostDate(post.date, locale)}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <h2 className="font-heading text-xl font-semibold tracking-tight text-ink transition-colors group-hover:text-brand">
                    {post.title}
                  </h2>
                  {/* 回退条目的徽标：标出正文语言，读者点进去前就知道是英文原文。 */}
                  {status === 'fallback' ? (
                    <span className="shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] font-medium tracking-wide text-neutral-500">
                      {t['blog.fallbackBadge']}
                    </span>
                  ) : null}
                </div>
                {post.description ? (
                  <p className="mt-2 text-[15px] leading-6 text-neutral-600">{post.description}</p>
                ) : null}
                {post.tags.length > 0 ? (
                  <p className="mt-2.5 text-xs text-neutral-500">
                    {post.tags.map((tag) => `#${tag}`).join('  ')}
                  </p>
                ) : null}
              </div>
            </LocaleLink>
          ))}
        </div>
      )}
    </div>
  )
}
