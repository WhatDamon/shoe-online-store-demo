import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { market } from './market'

/**
 * 价格格式化。**locale 只决定排版，货币仍由市场决定**（规格 §7：语言与市场正交）：
 * 中文界面显示 `US$128.00`（`Intl` 为中文排版加的市场限定符，货币仍是 USD）是刻意的，
 * 把货币绑到 locale 上会改动 ADR 0001 的市场边界。
 */
export function formatPrice(amount: number, locale: Locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: market.currency,
  }).format(amount)
}

/**
 * 文章日期的展示格式。**locale 必填，不给默认值**：日期标签是随语言变化的展示派生值，
 * 在任何不知道 locale 的地方预先算出来（旧 `BlogPost.dateLabel` 就是这样，由 `parsePostFile`
 * 在只有日期字符串时算好），必然产生「中文页显示英文日期」这类静默错误——字符串看着正常，
 * 只是语言错了。要求每个渲染点显式传 locale，才让这种错误在编译期暴露。
 *
 * `timeZone: 'UTC'`：frontmatter 的 `'YYYY-MM-DD'` 是 UTC 语义，跟运行时区走会让同一天在
 * 不同机器上变成前一天。
 */
export function formatPostDate(dateISO: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateISO}T00:00:00Z`))
}

/**
 * 复数选形：由语言的复数规则决定用哪一形，`'one'` 之外一律 `forms.other`
 * （英文 0 → other；中文 1/5 都是 other，即中文没有形态差异）。
 *
 * 判定必须交给 `Intl.PluralRules`：调用点写 `count === 1` 在英文下恰好等价，但换个语言就错。
 * 只提供 `one` / `other` 两形是刻意收窄——本仓库的复数文案只用到这两形，多出的形（如俄语 few）
 * 一旦需要，应该由类型层面加必填形来强制补齐，而不是在这里静默回落到 `other`。
 */
export function plural(
  count: number,
  locale: Locale,
  forms: { one: string; other: string },
): string {
  return new Intl.PluralRules(locale).select(count) === 'one' ? forms.one : forms.other
}
