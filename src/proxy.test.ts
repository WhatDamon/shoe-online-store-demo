import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { config, proxy } from './proxy'

const req = (path: string, init?: { method?: string; acceptLanguage?: string; cookie?: string }) =>
  new NextRequest(new URL(`https://evoloop.site${path}`), {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.acceptLanguage ? { 'accept-language': init.acceptLanguage } : {}),
      ...(init?.cookie ? { cookie: init.cookie } : {}),
    },
  })

describe('proxy 排除表', () => {
  it.each([
    '/api/ai/chat',
    '/api/commerce/cart',
    '/_next/static/chunk.js',
    '/og',
    '/robots.txt',
    '/sitemap.xml',
    '/favicon.ico',
    '/logo.png',
  ])('%s 直通', (path) => {
    expect(proxy(req(path)).headers.get('location')).toBeNull()
  })
})

describe('proxy 跳转', () => {
  it('无前缀 GET 永久跳转（308）', () => {
    const res = proxy(req('/shop'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://evoloop.site/en/shop')
  })
  it('无前缀非 GET 用 307', () => {
    // 审查重点 4
    const res = proxy(req('/cart', { method: 'POST' }))
    expect(res.status).toBe(307)
  })
  it.each([['/shop?color=red#top'], ['/product/dc-1001?size=42']])(
    '跳转保留查询串与锚点：%s',
    (path) => {
      // 审查重点 3
      const res = proxy(req(path))
      expect(res.headers.get('location')).toBe(`https://evoloop.site/en${path}`)
    },
  )
  it('已带前缀不跳转，且不叠加', () => {
    // 审查重点 2
    expect(proxy(req('/en/shop')).headers.get('location')).toBeNull()
    expect(proxy(req('/en')).headers.get('location')).toBeNull()
  })
  it('大小写不符不视为已带前缀', () => {
    // 审查重点 2
    expect(proxy(req('/EN/shop')).status).toBe(308)
  })
  it('畸形 Accept-Language 不抛错、落默认语言', () => {
    // 审查重点 1
    expect(() => proxy(req('/shop', { acceptLanguage: '<script>' }))).not.toThrow()
    expect(proxy(req('/shop', { acceptLanguage: ';q=abc' })).status).toBe(308)
  })
  it('依赖 Accept-Language 时带 Vary', () => {
    expect(proxy(req('/shop')).headers.get('vary')).toContain('Accept-Language')
  })
  it('协商重定向声明 private, no-store（目标还依赖 cookie，不能进共享缓存）', () => {
    // 审查重点：308 的目标不只取决于 Accept-Language，还取决于 evoloop_locale cookie——
    // 共享缓存按 Accept-Language 复用同一个 308 会把 cookie 已经选好的语言覆盖掉。
    const res = proxy(req('/shop', { acceptLanguage: 'zh-CN' }))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('vary')).toContain('Accept-Language')
  })
  it('页面响应不得被标成 no-store（308 的缓存语义不是页面响应的语义）', () => {
    // 只给重定向出口加 no-store：把 header 加到所有出口上会让每个 /en/* 页面响应
    // 都失去共享缓存（CDN / ISR）能力，代价与收益不成比例。
    expect(proxy(req('/en/shop')).headers.get('cache-control')).toBeNull()
    expect(proxy(req('/api/ai/chat')).headers.get('cache-control')).toBeNull()
    expect(proxy(req('/logo.png')).headers.get('cache-control')).toBeNull()
  })
  it('设置偏好 cookie 但不重定向（已带前缀时）', () => {
    const res = proxy(req('/en/shop'))
    expect(res.headers.get('set-cookie')).toContain('evoloop_locale=en')
  })
})

describe('proxy matcher', () => {
  it('排除 api 与静态资源', () => {
    // matcher 是按「带前导斜杠的 pathname」匹配的（`^/((?!api|...).*)`）。
    // 不要剥掉前导斜杠再拼正则——那会把 `(?!api...)` 挪到错误位置而变成恒真
    // （飞行前裁决 R16：原计划写法会让 `/api/...` 也判为 true）。
    const pattern = new RegExp(`^${config.matcher[0]}$`)
    expect(pattern.test('/api/ai/chat')).toBe(false)
    expect(pattern.test('/api/commerce/cart')).toBe(false)
    expect(pattern.test('/logo.png')).toBe(false)
    expect(pattern.test('/robots.txt')).toBe(false)
    expect(pattern.test('/sitemap.xml')).toBe(false)
    expect(pattern.test('/shop')).toBe(true)
    expect(pattern.test('/en/shop')).toBe(true)
  })
})
