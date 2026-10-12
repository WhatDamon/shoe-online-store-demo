import { describe, expect, it } from 'vitest'
import { LOCALES } from './locales'
import { messages, type Messages } from './messages'

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

// 显式键表：表里写了词典没有的键（拼错、被删、被改名）时 satisfies 在编译期报错；
// 词典加键而这张表没跟上时，下面的运行时断言失败。两条守卫方向互补。
const KEYS = [
  'nav.shop',
  'og.title',
  'notFound.title',
  'notFound.description',
  'notFound.cta',
] as const satisfies readonly (keyof Messages)[]

describe('键表单源', () => {
  it('运行时键集与显式键表一致', () => {
    expect(Object.keys(messages('en')).sort()).toEqual([...KEYS].sort())
  })
})
