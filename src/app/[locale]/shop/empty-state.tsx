import { LocaleLink } from '@/components/i18n/locale-link'
import { messages } from '@/i18n/messages'
import type { Locale } from '@/i18n/locales'

/**
 * 筛选无结果空态。`locale` 必填：唯一渲染点是 `/shop` 页面（RSC，手里就有 URL 语言），
 * 必填可避免「忘了传 → 静默渲染英文」——服务端组件没有 Provider 兜底。
 */
export function EmptyState({ locale }: { locale: Locale }) {
  const t = messages(locale)
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-surface/60 px-6 py-16 text-center">
      <h2 className="text-lg font-medium text-neutral-900">{t['shop.empty.title']}</h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">{t['shop.empty.body']}</p>
      <LocaleLink
        href="/shop"
        className="mt-4 text-sm font-medium text-neutral-900 underline underline-offset-4 transition-colors hover:text-neutral-600"
      >
        {t['shop.empty.cta']}
      </LocaleLink>
    </div>
  )
}
