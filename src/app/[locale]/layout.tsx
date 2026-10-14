import type { ReactElement, ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { baseMetadataFor } from '@/lib/seo'
import { Geist, Geist_Mono, Newsreader } from 'next/font/google'
import '../globals.css'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { AssistantProvider } from '@/components/assistant/assistant-provider'
import { SiteJsonLd } from '@/components/seo/site-json-ld'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { DEFAULT_LOCALE, isLocale, LOCALES } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
})

// SEO 基座集中在 src/lib/seo.ts（brand 模板 / metadataBase / OG），单点维护；这里只把
// **URL 段语言**交给它，`/zh-CN` 因此拿到中文的 description / keywords / og:locale。
// 非法语言段不在本函数里 404：`generateMetadata` 与 layout 是两条执行路径，本函数只负责
// 「拿不到可信语言段时用默认语言」，拦下非法段的是下面 layout 的 `notFound()`。
export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await props.params
  return baseMetadataFor(isLocale(raw) ? raw : DEFAULT_LOCALE)
}

// locale 由 URL 段带出，故本阶段（LOCALES 只有 'en'）只需要列出 /en 一棵树；
// 阶段 2 加语言时这里自动扩展，与词典的「缺键即编译错误」同向。
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

// 根布局位于 [locale] 段：`<html lang>` 必须等于 URL 语言，且词典只能在这里交给客户端。
export default async function RootLayout(props: {
  children: ReactNode
  params: Promise<{ locale: string }>
}): Promise<ReactElement> {
  const { locale } = await props.params
  // 非法语言段（如 /de/shop）不是页面：直接 404，绝不当成默认语言渲染。
  // `messages()` 对非法 locale 没有运行期防御（返回 undefined as Messages），
  // 因此校验必须在取词典之前。
  if (!isLocale(locale)) notFound()

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <LocaleProvider locale={locale} messages={messages(locale)}>
          <SiteJsonLd locale={locale} />
          <WishlistProvider>
            <AssistantProvider>{props.children}</AssistantProvider>
          </WishlistProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
