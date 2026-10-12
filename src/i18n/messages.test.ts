import { describe, expect, it } from 'vitest'
import { LOCALES, type Locale } from './locales'
import { messages } from './messages'

describe('messages', () => {
  it('每个声明的 locale 都有词典', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(messages(locale)).length).toBeGreaterThan(0)
    }
  })
  it('没有任何键的值是空串或 undefined', () => {
    // 审查重点 5
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages(locale))) {
        expect(typeof value, `${locale}.${key} 必须是 string`).toBe('string')
        expect(value.trim(), `${locale}.${key} 不能为空`).not.toBe('')
      }
    }
  })
  it('键名符合扁平点号约定', () => {
    // 裁决 R3
    for (const key of Object.keys(messages('en'))) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/)
    }
  })
  it('里程碑键存在且为英文原文', () => {
    expect(messages('en')['nav.shop']).toBe('Shop')
    expect(messages('en')['notFound.title']).toBe("We couldn't find that page")
    expect(messages('en')['notFound.cta']).toBe('Browse the shop')
  })
})

describe('Messages 类型', () => {
  it('类型与运行时键集一致', () => {
    const keys = Object.keys(messages('en')).sort()
    const typed: Array<keyof ReturnType<typeof messages>> = keys as never
    expect(typed.length).toBe(keys.length)
  })
})
