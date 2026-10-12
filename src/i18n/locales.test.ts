import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, LOCALES, isLocale, localePath, resolveLocale } from './locales'

describe('LOCALES', () => {
  it('阶段 1 只声明 en', () => {
    expect(LOCALES).toEqual(['en'])
    expect(DEFAULT_LOCALE).toBe('en')
  })
})

describe('isLocale', () => {
  it.each([
    ['en', true],
    ['zh-CN', false],
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
    ['zh-CN,zh;q=0.9', 'en'], // zh-CN 尚未在 LOCALES 中 → 默认
    ['*', 'en'],
    ['', 'en'],
    ['   ', 'en'],
    ['zh-CN;q=abc', 'en'], // 审查重点 1：畸形 q 值不抛错
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
