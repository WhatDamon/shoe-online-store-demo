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

  /**
   * 钉住 `estTokens` 对「扩展区汉字」与「emoji」的**实测**行为，使注释里那两条精确表述
   * （纯 CJK 恒等于 `s.length` / 非 CJK 仍按 0.25 低估）不会与实现漂移。
   * 期望值是逐字实测值，不是推断：U+20000 是 1 个码点、2 个 UTF-16 单元，故记 2；
   * emoji 是 2 个码点、4 个 UTF-16 单元，却按 `2 × 0.25 → 1` 计。
   */
  it('扩展区汉字按 char.length（2）计、emoji 仍按 0.25/字符低估', () => {
    expect(estTokens('\u{20000}')).toBe(2)
    expect(estTokens('中文\u{20000}文')).toBe(5)
    expect('中文\u{20000}文'.length).toBe(5)
    expect(estTokens('🎉👟')).toBe(1)
    expect('🎉👟'.length).toBe(4)
    expect(estTokens('🎉🎉🎉🎉')).toBe(1)
  })

  it('超长消息截断到 MAX_MESSAGE_CHARS', () => {
    const long = 'a'.repeat(maxMessageChars() + 500)
    expect(truncateMessage(long)).toHaveLength(maxMessageChars())
  })

  it('短消息原样返回', () => {
    expect(truncateMessage('hi')).toBe('hi')
  })
})
