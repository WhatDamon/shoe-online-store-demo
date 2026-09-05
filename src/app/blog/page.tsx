import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { listPosts, type BlogPost } from '@/lib/blog'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Blog',
  description: 'Stories, guides and notes from the Evoloop studio.',
})

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

function CoverSlot({ post }: { post: BlogPost }) {
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
        <CoverPlaceholder label={`${post.title} cover`} />
      )}
    </div>
  )
}

export default function BlogPage() {
  const posts = listPosts()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 sm:pt-14">
      <p className="text-sm font-medium text-brand">Journal</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Blog
      </h1>
      <p className="mt-3 text-[15px] leading-7 text-neutral-600">
        Stories, guides and notes from the studio — from how we size shoes to what happens inside
        the workshop.
      </p>

      {posts.length === 0 ? (
        <p className="mt-10 text-neutral-600">No articles yet — check back soon.</p>
      ) : (
        <div className="mt-10 flex flex-col divide-y divide-neutral-200">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group flex flex-col gap-4 py-7 sm:flex-row sm:gap-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-400"
            >
              <CoverSlot post={post} />
              <div className="flex min-w-0 flex-col">
                <p className="text-sm text-neutral-500">{post.dateLabel}</p>
                <h2 className="mt-1.5 font-heading text-xl font-semibold tracking-tight text-ink transition-colors group-hover:text-brand">
                  {post.title}
                </h2>
                {post.description ? (
                  <p className="mt-2 text-[15px] leading-6 text-neutral-600">{post.description}</p>
                ) : null}
                {post.tags.length > 0 ? (
                  <p className="mt-2.5 text-xs text-neutral-400">
                    {post.tags.map((tag) => `#${tag}`).join('  ')}
                  </p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
