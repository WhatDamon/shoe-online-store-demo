'use client'

import Link from 'next/link'
import type { ReactElement } from 'react'
import { usePathname } from 'next/navigation'
import { LOCALES, localePath, stripLocale, type Locale } from '@/i18n/locales'
import type { Messages } from '@/i18n/messages'
import { useLocale, useMessages } from './locale-provider'

/**
 * 语言切换器：每个语言一个链接，当前语言那项标 `aria-current`。
 *
 * **为什么是两个链接、不写 cookie**：访问带合法前缀的路径时 `src/proxy.ts` 已经在
 * 「cookie 与路径语言不一致」时用 `setLocalePreference` 持久化偏好，所以点链接即完成切换——
 * 无需 JS、无 hydration 依赖。也不该由 JS 写同名 cookie：服务端写的那份是 httpOnly 的，
 * JS 写出的非 httpOnly 副本会与它并存，之后读哪一份取决于浏览器与请求路径，结果不确定。
 *
 * **为什么链接不带 query**：`useSearchParams()` 会让所有使用 AppBar 的静态页被迫进
 * Suspense / 动态渲染，代价大于收益。这是有意的简化：切语言保留「当前页」，不保留
 * 搜索/筛选参数。
 *
 * **为什么用 `next/link` 而不是 `LocaleLink`（裁决 R38）**：`LocaleLink` 的语义是「用
 * **当前**语言给内部路径加前缀」。切换器要指向**另一个**语言的同一路径，前缀必须由切换
 * 目标整体决定；若走 `LocaleLink`，会再被当前语言补一次前缀，得到 `/zh-CN/en/shop`
 * 这种双重前缀。
 *
 * 标签是「语言自称」，不随界面语言翻译（`lang.en` = `'EN'`、`lang.zhCN` = `'中文'`，
 * 两个词典同值）：读屏用户在中文界面里也必须能找到 `EN` 这条出口。
 *
 * **外层是 `role="group"` 而不是 `<nav>`（裁决 R39）**：本组件在 AppBar 里出现两次
 *（桌面右侧与移动菜单，用 `md` 断点分界），两个同名 landmark 本身就是无障碍坏味道；
 * 且在 jsdom（不应用 CSS）里两个实例都在 DOM 中，多出的 landmark 会改变既有测试的
 * navigation 查询。移动端实例嵌在已有的 `<nav aria-label={t['marketing.appBar.mobileNav']}>` 内，
 * 不新增 landmark。
 */
const LABEL_KEY: Record<Locale, keyof Messages> = { en: 'lang.en', 'zh-CN': 'lang.zhCN' }

export function LanguageSwitcher(): ReactElement {
  const current = useLocale()
  const t = useMessages()
  const pathname = usePathname()
  // App Router 之外 `usePathname()` 返回 null（只渲染 AppBar 的组件测试就是这样；Pages Router
  // 兼容态同理）。回落到根路径，使切换器在任何消费点都能渲染（裁决 R37）。
  const rest = stripLocale(pathname ?? '/')

  return (
    <div role="group" aria-label={t['lang.switchLabel']} className="flex items-center gap-0.5">
      {LOCALES.map((locale) => (
        <Link
          key={locale}
          href={localePath(locale, rest)}
          aria-current={locale === current ? 'true' : undefined}
          className="rounded-full px-2 py-1.5 text-sm font-medium text-current transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          {t[LABEL_KEY[locale]]}
        </Link>
      ))}
    </div>
  )
}
