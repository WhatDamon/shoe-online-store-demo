// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { aiBudgetDays, aiBudgetReservations, aiUsage } from '@/db/schema'
import { createRepository } from '@/server/search/repository'
import { dailyTokenCap, reservationStaleMs, today, underDailyBudget } from './budget'

describe('budget', () => {
  it('accounts for completed usage above the cap and rejects conflicting settlement retries', async () => {
    const database = createDb(':memory:')
    const repo = createRepository(database)
    const day = '2026-10-01'
    await repo.reserveDailyBudget({ requestId: 'overrun', day, tokens: 80, cap: 100 })
    const input = {
      requestId: 'overrun',
      cap: 100,
      usage: { day, model: 'mock', promptTokens: 20, completionTokens: 100, sessionKey: 'test' },
    }
    expect(await repo.settleDailyBudget(input)).toBe(true)
    expect(await repo.settleDailyBudget(input)).toBe(true)
    expect(
      await repo.settleDailyBudget({ ...input, usage: { ...input.usage, completionTokens: 1 } }),
    ).toBe(false)
    expect(await repo.reserveDailyBudget({ requestId: 'next', day, tokens: 1, cap: 100 })).toBe(
      false,
    )
    expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
      reservedTokens: 0,
      usedTokens: 120,
    })
    expect(await repo.dayTokenUsage(day)).toBe(120)
    expect(database.select().from(aiUsage).all()).toHaveLength(1)
  })

  it('recovers old pending work in bounded batches without refunding uncertain costs', async () => {
    const database = createDb(':memory:')
    const repo = createRepository(database)
    const day = '2026-10-01'
    for (let i = 0; i < 5; i++)
      await repo.reserveDailyBudget({ requestId: `old-${i}`, day, tokens: 10, cap: 100 })
    database.update(aiBudgetReservations).set({ createdAt: 0 }).run()
    await repo.reserveDailyBudget({ requestId: 'live', day, tokens: 10, cap: 100 })
    expect(await repo.recoverDailyBudgetReservations(1, 2)).toBe(2)
    expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
      reservedTokens: 40,
      usedTokens: 20,
    })
    expect(await repo.recoverDailyBudgetReservations(1, 100)).toBe(3)
    expect(await repo.recoverDailyBudgetReservations(1, 100)).toBe(0)
    expect(await repo.abandonDailyBudget('old-0')).toBe(true)
    expect(await repo.releaseDailyBudget('old-0')).toBe(false)
    expect(await repo.reserveDailyBudget({ requestId: 'old-0', day, tokens: 10, cap: 100 })).toBe(
      false,
    )
    expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
      reservedTokens: 10,
      usedTokens: 50,
    })
    expect(await repo.dayTokenUsage(day)).toBe(50)
    expect(database.select().from(aiUsage).all()).toHaveLength(0)
  })

  it('rolls back counters when recovery status persistence fails', async () => {
    const database = createDb(':memory:')
    const repo = createRepository(database)
    await repo.reserveDailyBudget({
      requestId: 'rollback',
      day: '2026-10-01',
      tokens: 80,
      cap: 100,
    })
    database.run(sql`CREATE TRIGGER reject_recovery BEFORE UPDATE OF status ON ai_budget_reservations
      WHEN NEW.status = 'abandoned' BEGIN SELECT RAISE(ABORT, 'test_recovery_failure'); END`)
    await expect(repo.abandonDailyBudget('rollback')).rejects.toThrow()
    expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
      reservedTokens: 80,
      usedTokens: 0,
    })
    expect(database.select().from(aiBudgetReservations).all()[0].status).toBe('pending')
    database.run(sql`DROP TRIGGER reject_recovery`)
    expect(await repo.abandonDailyBudget('rollback')).toBe(true)
  })

  it('leaves at least five minutes and several provider deadlines before recovery', () => {
    expect(reservationStaleMs()).toBeGreaterThanOrEqual(300_000)
  })

  it('rejects changed retry inputs and cross-day settlement without altering the reservation', async () => {
    const repo = createRepository(createDb(':memory:'))
    const input = { requestId: 'identity', day: '2026-10-01', tokens: 80, cap: 100 }
    expect(await repo.reserveDailyBudget(input)).toBe(true)
    expect(await repo.reserveDailyBudget({ ...input, tokens: 20 })).toBe(false)
    expect(await repo.reserveDailyBudget({ ...input, day: '2026-10-02' })).toBe(false)
    expect(
      await repo.settleDailyBudget({
        requestId: input.requestId,
        usage: {
          day: '2026-10-02',
          model: 'mock',
          promptTokens: 10,
          completionTokens: 5,
          sessionKey: 'test',
        },
      }),
    ).toBe(false)
    expect(
      await repo.reserveDailyBudget({ requestId: 'another', day: input.day, tokens: 30, cap: 100 }),
    ).toBe(false)
    expect(await repo.dayTokenUsage(input.day)).toBe(0)
  })

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
