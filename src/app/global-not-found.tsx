import Link from 'next/link'
import type { Metadata } from 'next'
import { Geist, Newsreader } from 'next/font/google'
import './globals.css'
import { site } from '@/lib/site'
import { DEFAULT_LOCALE, localePath } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

// 全局 404：未匹配任何路由的 URL（如 /de/shop 落到 /en/de/shop）用它兜底。
// 它绕过正常渲染，不经过任何 layout，因此必须自己给出完整 HTML 文档、
// globals.css、字体与文案来源（见随包文档 app/api-reference/file-conventions/not-found.md）。
//
// 文案取自默认语言词典，不在这里硬编码；页面用默认语言渲染是刻意的——
// 未匹配的 URL 没有可信的语言段，而 Accept-Language 是客户端可篡改的输入，
// 不该影响这里的可见文案（阶段 2 加语言时由 proxy 的偏好 Cookie 决定优先级）。
const t = messages(DEFAULT_LOCALE)

// 本文件绕过 layout，拿不到根布局的 metadata（title 模板），不导出这一条时 head 里
// 会完全没有 <title>（只有 Next 为 404 自动注入的 robots: noindex）。标题同样取自词典。
export const metadata: Metadata = { title: t['notFound.title'] }

const sans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const heading = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
})

// 与 StatusShell 的状态页同一视觉，但刻意不 import 该模块：它会带进 AppBar /
// WishlistProvider 整套外壳（且 useWishlist 在无 Provider 时会抛错）。
const CTA_CLASS =
  'mt-8 inline-flex items-center justify-center rounded-full bg-ink px-7 py-3 text-sm font-medium text-canvas transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400'

export default function GlobalNotFound() {
  return (
    <html
      lang={DEFAULT_LOCALE}
      className={`${sans.variable} ${heading.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-24 text-center text-ink">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-brand">{site.name}</p>
          <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            {t['notFound.title']}
          </h1>
          <p className="mt-3 max-w-md text-neutral-600">{t['notFound.description']}</p>
          {/* 本页绕过 layout，没有 LocaleProvider 也没有可信语言段：逃生链接用默认语言推导，
              与上方的文生来源一致（不硬编码 `/en/shop`）。 */}
          <Link href={localePath(DEFAULT_LOCALE, '/shop')} className={CTA_CLASS}>
            {t['notFound.cta']}
          </Link>
        </div>
      </body>
    </html>
  )
}
