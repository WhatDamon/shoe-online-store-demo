import { describe, expect, it } from 'vitest'
import { estTokens, maxMessageChars, truncateMessage } from './text'

describe('text guardrails', () => {
  it('estTokens 按每 4 字符约 1 token 粗估（向上取整）', () => {
    expect(estTokens('')).toBe(0)
    expect(estTokens('abcd')).toBe(1)
    expect(estTokens('abcde')).toBe(2)
    expect(estTokens('a'.repeat(800))).toBe(200)
  })

  it('纯中文文本的估算不得低于字符数（否则日预算会被中文请求穿透）', () => {
    const zh = '我想找一双适合日常通勤的鞋，脚长二十五厘米，希望不要太窄。'
    expect(estTokens(zh)).toBeGreaterThanOrEqual(zh.length)
  })

  it('中英混合时中文按字、英文按 4 字 1 token，不会退回旧公式', () => {
    const mixed = 'I need a size 43 的鞋'
    expect(estTokens(mixed)).toBeGreaterThan(Math.ceil(mixed.length / 4))
  })

  it('纯英文的估算与旧公式逐位相同（不波及既有预算断言）', () => {
    const en = 'Looking for something light for city walks'
    expect(estTokens(en)).toBe(Math.ceil(en.length / 4))
  })

  it('空串为 0；纯 emoji 与纯标点有界且不抛错', () => {
    expect(estTokens('')).toBe(0)
    expect(estTokens('🎉👟')).toBeGreaterThan(0)
    expect(estTokens('?!?')).toBe(1)
  })

  it('超长消息截断到 MAX_MESSAGE_CHARS', () => {
    const long = 'a'.repeat(maxMessageChars() + 500)
    expect(truncateMessage(long)).toHaveLength(maxMessageChars())
  })

  it('短消息原样返回', () => {
    expect(truncateMessage('hi')).toBe('hi')
  })
})
