import { describe, expect, it } from 'vitest'
import { HISTORY_TURNS, MAX_TURNS, SESSION_TTL_MS, createSessionStore } from './session-state'

describe('createSessionStore', () => {
  it('回合数达 MAX_TURNS 后第 MAX_TURNS+1 次拒绝', () => {
    const s = createSessionStore()
    for (let i = 0; i < MAX_TURNS; i++) {
      expect(s.claim('k', i).allowed).toBe(true)
    }
    expect(s.claim('k', MAX_TURNS).allowed).toBe(false)
  })

  it('TTL 过期后会话重置、可再次 claim', () => {
    const s = createSessionStore()
    expect(s.claim('k', 0).allowed).toBe(true)
    expect(s.claim('k', 1).allowed).toBe(true) // TTL 内续用
    expect(s.claim('k', 1 + SESSION_TTL_MS).allowed).toBe(true) // 过期重置后允许
  })

  it('history 仅保留最近 HISTORY_TURNS 轮（2*HISTORY_TURNS 条）', () => {
    const s = createSessionStore()
    s.claim('k', 0)
    for (let i = 1; i <= 20; i++) {
      s.push('k', i % 2 === 0 ? 'assistant' : 'user', `m${i}`)
    }
    const { allowed, history } = s.claim('k', 1)
    expect(allowed).toBe(true)
    expect(history).toHaveLength(HISTORY_TURNS * 2)
    expect(history[0]).toEqual({ role: 'user', content: 'm9' })
    expect(history[history.length - 1]).toEqual({
      role: 'assistant',
      content: 'm20',
    })
  })

  it('push 仅作用于既有会话；不同 key 独立', () => {
    const s = createSessionStore()
    expect(s.claim('a', 0).history).toEqual([])
    s.push('a', 'user', 'hello')
    s.push('ghost', 'user', 'ignored') // 无会话则不记录
    expect(s.claim('a', 1).history).toEqual([{ role: 'user', content: 'hello' }])
    expect(s.claim('b', 1).history).toEqual([])
  })
})
