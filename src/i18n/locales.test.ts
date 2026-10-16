import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  localePath,
  resolveLocale,
  stripLocale,
} from './locales'

describe('LOCALES', () => {
  // 语言集合的期望值随 `LOCALES` 本身变化（裁决 R35：改语言集合的那个任务承担这类机械后果）。
  it('en 与 zh-CN 均已声明', () => {
    expect(LOCALES).toEqual(['en', 'zh-CN'])
    expect(DEFAULT_LOCALE).toBe('en')
  })
})

describe('isLocale', () => {
  it.each([
    ['en', true],
    ['zh-CN', true],
    ['', false],
    ['EN', false],
    [null, false],
    [undefined, false],
  ])('%s -> %s', (input, expected) => {
    expect(isLocale(input as string)).toBe(expected)
  })
})

describe('resolveLocale', () => {
  it('合法 cookie 优先于 Accept-Language', () => {
    expect(resolveLocale('en-US,en;q=0.9', 'en')).toBe('en')
  })
  it('非法 cookie 被忽略', () => {
    expect(resolveLocale('en', 'not-a-locale')).toBe('en')
  })
  it.each([
    ['en-US,en;q=0.9', 'en'],
    ['zh-CN,zh;q=0.9', 'zh-CN'], // 首段全串精确命中，优先于主语言前缀
    ['*', 'en'],
    ['', 'en'],
    ['   ', 'en'],
    ['zh-CN;q=abc', 'zh-CN'], // 审查重点 1：畸形 q 值按 1 处理且不抛错，仍是首段
    [';;;', 'en'],
    ['<script>alert(1)</script>', 'en'], // 审查重点 1：不回显、不抛错
    ['a'.repeat(10_000), 'en'], // 审查重点 1：超长头不抛错
  ])('Accept-Language %s -> %s', (header, expected) => {
    expect(resolveLocale(header, null)).toBe(expected)
  })
})

describe('localePath', () => {
  it.each([
    ['en', '/', '/en'],
    ['en', '/shop', '/en/shop'],
    ['en', 'shop', '/en/shop'],
    ['en', '/en/shop', '/en/shop'], // 审查重点 2：不叠加前缀
    ['en', '/en', '/en'],
    ['en', '/enen/shop', '/en/enen/shop'], // 审查重点 2：不把 enen 当已带前缀
    ['en', '/EN/shop', '/en/EN/shop'], // 审查重点 2：大小写敏感，不视为已带前缀
  ])('localePath(%s, %s) -> %s', (locale, path, expected) => {
    expect(localePath(locale as 'en', path)).toBe(expected)
  })
  it('保留查询串与锚点', () => {
    // 审查重点 3
    expect(localePath('en', '/shop?color=red#top')).toBe('/en/shop?color=red#top')
  })
  it('已是绝对 URL 时原样返回', () => {
    expect(localePath('en', 'https://evoloop.site/shop')).toBe('https://evoloop.site/shop')
  })
})

describe('stripLocale', () => {
  it.each([
    ['/en/shop?q=a#b', '/shop?q=a#b'],
    ['/en', '/'],
    ['/zh-CN', '/'],
    ['/zh-CN/shop', '/shop'],
    ['/', '/'],
    ['/shop', '/shop'], // 无合法前缀原样
    ['/enen/shop', '/enen/shop'], // 与 localePath 同一口径：/enen 不算已带前缀
    ['/EN/shop', '/EN/shop'], // 大小写敏感
    ['/en/../api', '/../api'], // 不做路径规范化（与 localePath 对称），也不抛
  ])('stripLocale(%s) -> %s', (path, expected) => {
    expect(stripLocale(path)).toBe(expected)
  })

  it('localePath ∘ stripLocale 往返幂等（不会双重前缀）', () => {
    // 审查重点 4：切换语言 = `localePath(to, stripLocale(当前 pathname))`。
    // 若 stripLocale 漏掉前缀，第二次切换就会叠成 /en/zh-CN/shop。
    for (const from of LOCALES) {
      for (const to of LOCALES) {
        const once = localePath(to, stripLocale(localePath(from, '/shop')))
        const twice = localePath(to, stripLocale(once))
        expect(twice, `${from} -> ${to}`).toBe(once)
      }
    }
  })
})

describe('stripLocale 边界输入（审查者给的输入表）', () => {
  // 这些期望值是审查者列出的边界输入表：与其做一次性探针，不如永久钉住。
  // 弦外之音：每一条都编码一条具体口径——空串不抛、query/hash 原样、纯前缀成根、
  // 保留尾斜杠、绝对 URL 不误判、超长路径不抛、无前导斜杠不当前缀。
  it.each([
    ['', ''],
    ['/', '/'],
    ['?q=1', '?q=1'], // 只有 query：不是路径，原样
    ['#top', '#top'], // 同上
    ['/en?q=a', '/?q=a'], // 纯前缀 + query：剥成根，query 保留
    ['/en#top', '/#top'],
    ['/en/', '/'], // 前缀 + 尾斜杠：剥剩 '/'，不额外规范化
    ['/zh-CN/shop/', '/shop/'], // 保留尾斜杠（不做规范化）
    ['http://x/y', 'http://x/y'], // 绝对 URL 不会被误当成 `/http:...`
    ['zh-CN/zebra', 'zh-CN/zebra'], // 无前导斜杠：`zh-CN/` 不构成 `/zh-CN/` 前缀
  ])('stripLocale(%s) -> %s', (path, expected) => {
    expect(stripLocale(path)).toBe(expected)
  })

  it('超长路径不抛错，且只剥掉前缀', () => {
    const long = `/en/${'a'.repeat(100_000)}`
    const result = stripLocale(long)
    expect(result.startsWith('/a')).toBe(true)
    expect(result).toHaveLength(long.length - '/en'.length)
  })
})
