import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_CHARS, estTokens, truncateMessage } from './text'

describe('text guardrails', () => {
  it('estTokens 按每 4 字符约 1 token 粗估（向上取整）', () => {
    expect(estTokens('')).toBe(0)
    expect(estTokens('abcd')).toBe(1)
    expect(estTokens('abcde')).toBe(2)
    expect(estTokens('a'.repeat(800))).toBe(200)
  })

  it('超长消息截断到 MAX_MESSAGE_CHARS', () => {
    const long = 'a'.repeat(MAX_MESSAGE_CHARS + 500)
    expect(truncateMessage(long)).toHaveLength(MAX_MESSAGE_CHARS)
  })

  it('短消息原样返回', () => {
    expect(truncateMessage('hi')).toBe('hi')
  })
})
