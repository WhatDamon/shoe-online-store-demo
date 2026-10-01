// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createDb } from '@/db/client'
import { aiUsage } from '@/db/schema'
import { createRepository } from '@/server/search/repository'
import { dailyTokenCap, today, underDailyBudget } from './budget'

describe('budget', () => {
  it('counts usage written before the atomic budget tables were introduced', async () => {
    const database = createDb(':memory:')
    // Reproduce an existing deployment with a legacy ledger but no day counter.
    database
      .insert(aiUsage)
      .values({
        day: '2026-09-30',
        model: 'mock',
        promptTokens: 80,
        completionTokens: 10,
        sessionKey: 'legacy',
        createdAt: 0,
      })
      .run()
    const repo = createRepository(database)
    await expect(
      repo.reserveDailyBudget({
        requestId: 'new-request',
        day: '2026-09-30',
        tokens: 20,
        cap: 100,
      }),
    ).resolves.toBe(false)
    await expect(
      repo.reserveDailyBudget({
        requestId: 'fits',
        day: '2026-09-30',
        tokens: 10,
        cap: 100,
      }),
    ).resolves.toBe(true)
  })

  it('原子预占在并发请求下不会超过 cap，结算只写入一次实际用量', async () => {
    const repo = createRepository(createDb(':memory:'))
    const requests = await Promise.all(
      ['r1', 'r2', 'r3'].map((requestId) =>
        repo.reserveDailyBudget({ requestId, day: '2026-09-28', tokens: 60, cap: 100 }),
      ),
    )
    expect(requests.filter(Boolean)).toHaveLength(1)
    expect(
      await repo.reserveDailyBudget({ requestId: 'r1', day: '2026-09-28', tokens: 60, cap: 100 }),
    ).toBe(true)
    expect(
      await repo.settleDailyBudget({
        requestId: 'r1',
        usage: {
          day: '2026-09-28',
          model: 'mock',
          promptTokens: 10,
          completionTokens: 5,
          sessionKey: 's1',
        },
      }),
    ).toBe(true)
    expect(
      await repo.settleDailyBudget({
        requestId: 'r1',
        usage: {
          day: '2026-09-28',
          model: 'mock',
          promptTokens: 10,
          completionTokens: 5,
          sessionKey: 's1',
        },
      }),
    ).toBe(true)
    expect(await repo.dayTokenUsage('2026-09-28')).toBe(15)
  })

  it('provider 失败释放 pending 预占，之后可再次申请', async () => {
    const repo = createRepository(createDb(':memory:'))
    await expect(
      repo.reserveDailyBudget({ requestId: 'failed', day: '2026-09-28', tokens: 90, cap: 100 }),
    ).resolves.toBe(true)
    await expect(repo.releaseDailyBudget('failed')).resolves.toBe(true)
    await expect(
      repo.reserveDailyBudget({ requestId: 'retry', day: '2026-09-28', tokens: 90, cap: 100 }),
    ).resolves.toBe(true)
  })

  it('当日用量为零时放行', async () => {
    const repo = createRepository(createDb(':memory:'))
    expect(await underDailyBudget(repo)).toBe(true)
  })

  it('插入接近 cap 的用量后拒绝（跨日不影响当日判断）', async () => {
    const repo = createRepository(createDb(':memory:'))
    await repo.insertUsage({
      day: today(),
      model: 'mock',
      promptTokens: Math.floor(dailyTokenCap() / 2),
      completionTokens: Math.floor(dailyTokenCap() / 2) + 1,
      sessionKey: 's1',
    })
    expect(await underDailyBudget(repo)).toBe(false)
    expect(await underDailyBudget(repo, '2000-01-01')).toBe(true)
  })

  it('today 返回 YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
