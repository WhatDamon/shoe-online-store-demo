// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '@/db/client'
import { aiBudgetDays, aiBudgetReservations, aiUsage } from '@/db/schema'
import { createGuardrails } from '@/server/guardrails'
import { createRepository } from '@/server/search/repository'
import { chat, type ChatRequest } from './chat'
import type { AiProvider } from './provider'

const request: ChatRequest = {
  sessionKey: 'budget-session',
  ip: '127.0.0.1',
  mode: 'support',
  text: 'What is the store policy?',
  product: null,
}

beforeEach(() => {
  vi.stubEnv('AI_API_KEY', '')
  vi.stubEnv('AI_DISABLE_REAL', '1')
  vi.stubEnv('AI_DAILY_TOKEN_CAP', '1000000')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('chat with atomic budgets and bounded session state', () => {
  it.each(['provider failure', 'timeout', 'consumer interruption'])(
    'releases a reservation after %s without recording a completed turn',
    async (failure) => {
      const database = createDb(':memory:')
      const guardrails = createGuardrails(createRepository(database))
      const provider: AiProvider = {
        async *stream() {
          yield 'partial reply'
          throw failure === 'timeout'
            ? new DOMException('timed out', 'TimeoutError')
            : new Error('provider failed')
        },
      }
      const stream = chat(request, { guardrails, provider })
      try {
        expect((await stream.next()).value).toMatchObject({ type: 'delta' })
        expect(database.select().from(aiBudgetReservations).all()[0].status).toBe('pending')
        expect(database.select().from(aiBudgetDays).all()[0].reservedTokens).toBeGreaterThan(0)
        if (failure === 'consumer interruption') {
          await stream.return(undefined)
        } else {
          expect((await stream.next()).value).toMatchObject({ type: 'error', code: 'provider' })
          expect(console.error).toHaveBeenCalledWith('[ai/chat] provider failure')
          await stream.return(undefined) // Route handlers stop after the error frame.
        }
        expect(database.select().from(aiBudgetReservations).all()[0].status).toBe('released')
        expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
          reservedTokens: 0,
          usedTokens: 0,
        })
        expect(database.select().from(aiUsage).all()).toEqual([])
        expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
      } finally {
        await stream.return(undefined)
        guardrails.dispose()
      }
    },
  )

  it('settles once against the reservation UTC date when the stream crosses midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T23:59:59Z'))
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const provider: AiProvider = {
      async *stream() {
        yield 'Store policy.'
      },
    }
    const stream = chat(request, { guardrails, provider })
    try {
      expect((await stream.next()).value).toMatchObject({ type: 'delta' })
      vi.setSystemTime(new Date('2026-10-01T00:00:01Z'))
      expect((await stream.next()).value).toEqual({ type: 'done' })
      await stream.return(undefined)
      const usage = database.select().from(aiUsage).all()
      expect(usage).toHaveLength(1)
      expect(usage[0].day).toBe('2026-09-30')
      expect(database.select().from(aiBudgetReservations).all()[0]).toMatchObject({
        day: '2026-09-30',
        status: 'settled',
      })
      expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
        day: '2026-09-30',
        reservedTokens: 0,
        usedTokens: usage[0].promptTokens + usage[0].completionTokens,
      })
      expect(guardrails.assertTurn(request.sessionKey)).toHaveLength(2)
    } finally {
      await stream.return(undefined)
      guardrails.dispose()
    }
  })
})
