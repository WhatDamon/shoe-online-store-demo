import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { market } from './market'

/**
 * 价格格式化。**locale 只决定排版，货币仍由市场决定**（规格 §7：语言与市场正交）：
 * 中文界面显示 `$128.00` 是刻意的，把货币绑到 locale 上会改动 ADR 0001 的市场边界。
 */
export function formatPrice(amount: number, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: market.currency,
  }).format(amount)
}
