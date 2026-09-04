// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createDb } from '@/db/client'
import { createRepository } from '@/server/search/repository'
import { DAILY_TOKEN_CAP, today, underDailyBudget } from './budget'

describe('budget', () => {
  it('当日用量为零时放行', async () => {
    const repo = createRepository(createDb(':memory:'))
    expect(await underDailyBudget(repo)).toBe(true)
  })

  it('插入接近 cap 的用量后拒绝（跨日不影响当日判断）', async () => {
    const repo = createRepository(createDb(':memory:'))
    await repo.insertUsage({
      day: today(),
      model: 'mock',
      promptTokens: Math.floor(DAILY_TOKEN_CAP / 2),
      completionTokens: Math.floor(DAILY_TOKEN_CAP / 2) + 1,
      sessionKey: 's1',
    })
    expect(await underDailyBudget(repo)).toBe(false)
    expect(await underDailyBudget(repo, '2000-01-01')).toBe(true)
  })

  it('today 返回 YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
