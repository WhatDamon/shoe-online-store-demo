'use client'

import Link from 'next/link'
import type { ComponentProps, ReactElement } from 'react'
import { localePath } from '@/i18n/locales'
import { useLocale } from './locale-provider'

/**
 * 站内链接统一走这里：`next/link` 在 App Router 下不会自动加 locale 前缀，
 * 而 URL 的语言段是显式的（不是请求头里的隐式状态）。
 */
export function LocaleLink({ href, ...props }: ComponentProps<typeof Link>): ReactElement {
  const locale = useLocale()
  // `href` 也可能是 `next/link` 的 UrlObject 形态。那种形态无法在这里做路径前缀运算，
  // 故原样透传，由调用方自己在对象里带 locale —— 强行 `String(href)` 会得到
  // `"[object Object]"` 这种无效路径，比不加前缀错得更远。
  const localizedHref = typeof href === 'string' ? localePath(locale, href) : href
  return <Link {...props} href={localizedHref} />
}
