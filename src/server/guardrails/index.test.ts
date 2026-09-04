// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createDb } from '@/db/client'
import { createRepository } from '@/server/search/repository'
import { DAILY_TOKEN_CAP, today } from './budget'
import { MAX_TURNS } from './session-state'
import { GUARDRAIL_MESSAGE, GuardrailError, RATE_PER_MIN, createGuardrails } from './index'

const fresh = () => createGuardrails(createRepository(createDb(':memory:')))

describe('createGuardrails', () => {
  it('assertTurn 达 MAX_TURNS 后抛 code=turns 的温和拒答', () => {
    const g = fresh()
    for (let i = 0; i < MAX_TURNS; i++) {
      expect(g.assertTurn('ses-a')).toEqual([])
    }
    try {
      g.assertTurn('ses-a')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(GuardrailError)
      expect((e as GuardrailError).code).toBe('turns')
      expect((e as GuardrailError).message).toBe(GUARDRAIL_MESSAGE)
    }
  })

  it('assertTurn 返回裁剪后的历史；pushTurn 写入同一会话', () => {
    const g = fresh()
    g.assertTurn('ses-h')
    g.pushTurn('ses-h', 'user', 'hello')
    g.pushTurn('ses-h', 'assistant', 'hi there')
    const history = g.assertTurn('ses-h')
    expect(history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ])
  })

  it('assertRate 超过 RATE_PER_MIN 后抛 code=rate_limited，且文案不暴露工程措辞', () => {
    const g = fresh()
    for (let i = 0; i < RATE_PER_MIN; i++) {
      expect(() => g.assertRate('ip-r', 'ses-r')).not.toThrow()
    }
    try {
      g.assertRate('ip-r', 'ses-r')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as GuardrailError).code).toBe('rate_limited')
      expect((e as GuardrailError).message).toContain('short break')
      expect((e as GuardrailError).message).not.toMatch(/rate\s*limited/i)
    }
  })

  it('assertRate 双维独立：耗尽会话桶后新 IP 也被拒，新 IP+新会话放行', () => {
    const g = fresh()
    for (let i = 0; i < RATE_PER_MIN; i++) {
      g.assertRate('ip-1', 'ses-1') // 耗尽双桶
    }
    expect(() => g.assertRate('ip-new', 'ses-1')).toThrow(GuardrailError) // 会话维度已空
    expect(() => g.assertRate('ip-new', 'ses-new')).not.toThrow() // 全新双 key 放行
  })

  it('assertBudget 用量越界后抛 code=budget；noteUsage 落库可被日汇总读取', async () => {
    const repo = createRepository(createDb(':memory:'))
    const g = createGuardrails(repo)
    await g.noteUsage({
      day: today(),
      model: 'mock',
      promptTokens: Math.floor(DAILY_TOKEN_CAP / 2),
      completionTokens: Math.floor(DAILY_TOKEN_CAP / 2) + 1,
      sessionKey: 'ses-b',
    })
    expect(await repo.dayTokenUsage(today())).toBeGreaterThanOrEqual(DAILY_TOKEN_CAP)
    await expect(g.assertBudget()).rejects.toMatchObject({ code: 'budget' })
  })

  it('GuardrailError 携带 code 且为 Error 子类', () => {
    const e = new GuardrailError('budget', GUARDRAIL_MESSAGE)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('budget')
    expect(e.message).toBe(GUARDRAIL_MESSAGE)
  })
})
