import { NextRequest, NextResponse } from 'next/server'
import { isLocale, localePath, resolveLocale, type Locale } from '@/i18n/locales'

// 偏好 Cookie：只记住「上次访问的语言」，不参与任何交易事实（价格、库存、订单、会话）。
// 它不是 commerce 会话——本文件既不读也不写 X-Session-ID 等既有会话 Cookie。
const LOCALE_COOKIE = 'evoloop_locale'
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const config: { matcher: string[] } = {
  // 排除表：API、Next 静态资源与图片优化、og 图、robots/sitemap/favicon、以及任何带
  // 扩展名的静态文件。matcher 由 Next 在构建期静态分析，必须是字面量常量数组。
  matcher: ['/((?!api|_next/static|_next/image|og|robots.txt|sitemap.xml|favicon.ico|.*\\..*).*)'],
}

// 与 matcher 同一串编译一次：函数内也做一次排除，使直接调用 proxy() 的行为与线上
// （matcher 已过滤）一致，且两处排除表不会各自漂移。
const PAGE_PATH = new RegExp(`^${config.matcher[0]}$`)

/**
 * 唯一的路由协商点：无前缀 URL → 永久跳转到默认语言的 /[locale]/...。
 * 已带合法前缀的请求直通（只按需更新偏好 Cookie），因此不存在 /en/en/shop 这类叠加跳转。
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search, hash } = request.nextUrl

  // 显式早退，独立于上面的 matcher：即使 matcher 被改坏，也不能让 /api/** 吃到
  // 307/308（那会改写写操作语义，破坏 commerce 与其它 API 的交易边界）。
  if (pathname === '/api' || pathname.startsWith('/api/')) return withVary(NextResponse.next())

  if (!PAGE_PATH.test(pathname)) return withVary(NextResponse.next())

  const requested = pathname.split('/')[1] ?? ''
  if (isLocale(requested)) {
    const response = withVary(NextResponse.next())
    // 只在偏好与路径不一致时写 Cookie：无条件写会让每个 /en/* 响应都带 Set-Cookie，
    // 使原本可被共享缓存（CDN / ISR）的页面失去可缓存性。
    return request.cookies.get(LOCALE_COOKIE)?.value === requested
      ? response
      : setLocalePreference(response, requested)
  }

  const locale = resolveLocale(
    request.headers.get('accept-language'),
    request.cookies.get(LOCALE_COOKIE)?.value ?? null,
  )
  // GET/HEAD 是安全方法：永久跳转。其余方法（POST 加入购物车等）可能携带副作用，
  // 307 保留方法与请求体，且不把非幂等请求永久改写。
  const status = request.method === 'GET' || request.method === 'HEAD' ? 308 : 307
  const destination = localePath(locale, `${pathname}${search}${hash}`)
  const response = withVary(
    NextResponse.redirect(new URL(destination, request.nextUrl.origin), status),
  )
  // 重定向目标不只取决于 `Accept-Language`，还取决于 `evoloop_locale` cookie（`Vary` 只能表达
  // 请求头维度）。按 `Accept-Language` 复用同一个 308 会把 cookie 已选好的语言覆盖掉，
  // 故重定向出口声明 `private, no-store`。只加在这一处：页面响应（上面两条 `NextResponse.next()`）
  // 不该被标成 no-store，那会让每个 /en/* 响应失去共享缓存（CDN / ISR）能力。
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

/** 所有出口都声明 Vary：响应取决于 Accept-Language，共享缓存不得跨语言复用。 */
function withVary(response: NextResponse): NextResponse {
  response.headers.set('Vary', 'Accept-Language')
  return response
}

function setLocalePreference(response: NextResponse, locale: Locale): NextResponse {
  response.cookies.set({
    name: LOCALE_COOKIE,
    value: locale,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
  })
  return response
}
