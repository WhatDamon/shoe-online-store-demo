/**
 * Locale 是界面语言，也是 URL 的一段（不是请求头里的隐式状态）。
 * 它与市场正交：`SITE_MARKET` 与货币不受 locale 影响。
 *
 * 本模块必须保持纯：`src/server/**`（服务端产生的消费端文案）与客户端组件都要导入同一份定义，
 * 因此不导入 React、不导入 `src/server/**`、不做 IO、不读 `process.env`。
 */
export const LOCALES = ['en', 'zh-CN'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.some((locale) => locale === value)
}

// 顺序固定：合法 cookie → Accept-Language → 默认语言。
export function resolveLocale(acceptLanguage: string | null, cookie: string | null): Locale {
  if (isLocale(cookie)) return cookie
  return preferredLocale(acceptLanguage) ?? DEFAULT_LOCALE
}

export function localePath(locale: Locale, path: string): string {
  if (ABSOLUTE_URL.test(path)) return path
  const [pathname, suffix] = splitPath(path)
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  // 前缀判定大小写敏感，且要求 `/` 或整段相同：`/enen` 不算已带前缀。
  if (normalized === `/${locale}` || normalized.startsWith(`/${locale}/`)) {
    return `${normalized}${suffix}`
  }
  // 根路径不加尾斜杠：`/` → `/en`，与上面的「已带前缀」判定同一口径。
  const rest = normalized === '/' ? '' : normalized
  return `/${locale}${rest}${suffix}`
}

/**
 * `localePath` 的逆运算：去掉开头的 `/<合法 locale>` 段，供语言切换使用
 * （`stripLocale('/zh-CN/shop')` → `'/shop'`，再 `localePath('en', rest)` → `'/en/shop'`）。
 *
 * 与 `localePath` 共用 `splitPath`（单一来源）：前缀只作用于路径段，query/hash 原样保留。
 * 前缀判定沿用同一口径（大小写敏感、要求 `/` 或整段相同），否则 `/enen/shop` 会被误剥。
 * 只做字符串前缀剥离，**不做路径规范化**（`/en/../api` → `/../api`）——
 * 路径里有什么由路由层判定；这里多做一步只会与 `localePath` 的对称性脱节。
 * 不带合法前缀时原样返回，绝不抛错。
 */
export function stripLocale(path: string): string {
  const [pathname, suffix] = splitPath(path)
  for (const locale of LOCALES) {
    const prefix = `/${locale}`
    // 只有前缀：`/en` → `/`；query/hash 原样拼回。
    if (pathname === prefix) return `/${suffix}`
    if (pathname.startsWith(`${prefix}/`)) return `${pathname.slice(prefix.length)}${suffix}`
  }
  return path
}

/** 拆成 `pathname + search + hash`，使前缀只作用于路径段。 */
function splitPath(path: string): [pathname: string, suffix: string] {
  const boundary = path.search(/[?#]/)
  return boundary === -1 ? [path, ''] : [path.slice(0, boundary), path.slice(boundary)]
}

function preferredLocale(header: string | null): Locale | null {
  for (const { tag } of parseAcceptLanguage(header)) {
    const matched = matchLocale(tag)
    if (matched !== null) return matched
  }
  return null
}

/**
 * 逐段尝试：`*` 视为匹配默认语言；先按大小写不敏感的全串比较，再按主语言前缀比较。
 * 不合法的标签只是不匹配，绝不抛错——Accept-Language 是客户端可控输入。
 */
function matchLocale(tag: string): Locale | null {
  if (tag === '*') return DEFAULT_LOCALE
  const lower = tag.toLowerCase()
  const exact = LOCALES.find((locale) => locale.toLowerCase() === lower)
  if (exact !== undefined) return exact
  const primary = lower.split('-')[0]
  return LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === primary) ?? null
}

/** 按 q 降序；q 相同的保持书写顺序（`Array.prototype.sort` 稳定）。 */
function parseAcceptLanguage(header: string | null): { tag: string; quality: number }[] {
  if (header === null || header === '') return []
  return header
    .split(',')
    .map((segment) => {
      const [tag = '', ...parameters] = segment.split(';')
      return { tag: tag.trim(), quality: readQuality(parameters) }
    })
    .sort((a, b) => b.quality - a.quality)
}

/** 畸形或越界的 q 值按 `q=1`，避免把不可解析的偏好当成「不想要」。 */
function readQuality(parameters: string[]): number {
  const parameter = parameters.find((part) => part.trim().toLowerCase().startsWith('q='))
  if (parameter === undefined) return 1
  const raw = parameter.trim().slice(2).trim()
  const quality = raw === '' ? Number.NaN : Number(raw)
  return Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 1
}
