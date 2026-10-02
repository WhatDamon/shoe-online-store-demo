// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '@/db/client'
import { aiBudgetDays, aiBudgetReservations, aiUsage } from '@/db/schema'
import { createGuardrails } from '@/server/guardrails'
import { createRepository } from '@/server/search/repository'
import { chat, type ChatRequest } from './chat'
import type { AiProvider } from './provider'
import type { EmbeddingRunner, RetrievalOptions } from './retrieval-gateway'

const { mockRetrieveProducts } = vi.hoisted(() => ({ mockRetrieveProducts: vi.fn() }))
vi.mock('./retrieval-gateway', () => ({ retrieveProducts: mockRetrieveProducts }))

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
  mockRetrieveProducts.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('chat with atomic budgets and bounded session state', () => {
  it.each(['provider failure', 'timeout', 'consumer interruption'])(
    'conservatively accounts for %s without recording a completed turn',
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
        const reservation = database.select().from(aiBudgetReservations).all()[0]
        expect(reservation).toMatchObject({
          status: 'abandoned',
          actualTokens: reservation.reservedTokens,
        })
        expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
          reservedTokens: 0,
          usedTokens: reservation.reservedTokens,
        })
        expect(database.select().from(aiUsage).all()).toEqual([])
        expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
      } finally {
        await stream.return(undefined)
        guardrails.dispose()
      }
    },
  )

  it('does not refund an attempted provider call even if it fails before any delta', async () => {
    const database = createDb(':memory:')
    const repo = createRepository(database)
    const guardrails = createGuardrails(repo)
    const provider: AiProvider = {
      async *stream() {
        throw new Error('uncertain provider cost')
      },
    }
    try {
      for await (const event of chat(request, { guardrails, provider })) {
        expect(event).toMatchObject({ type: 'error', code: 'provider' })
      }
      const reservation = database.select().from(aiBudgetReservations).all()[0]
      expect(reservation.status).toBe('abandoned')
      expect(await repo.dayTokenUsage(reservation.day)).toBe(reservation.reservedTokens)
    } finally {
      guardrails.dispose()
    }
  })

  it('preserves accounting when completed provider output cannot be written to the ledger', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    vi.spyOn(guardrails, 'settleBudget').mockRejectedValue(new Error('database failed'))
    const provider: AiProvider = {
      async *stream() {
        yield 'completed provider output'
      },
    }
    try {
      for await (const event of chat(request, { guardrails, provider })) {
        expect(['delta', 'error']).toContain(event.type)
      }
      const reservation = database.select().from(aiBudgetReservations).all()[0]
      expect(reservation.status).toBe('abandoned')
      expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
        reservedTokens: 0,
        usedTokens: reservation.reservedTokens,
      })
      expect(database.select().from(aiUsage).all()).toHaveLength(0)
    } finally {
      guardrails.dispose()
    }
  })

  it('falls back to character estimates when provider usage is invalid', async () => {
    const run = async (provider: AiProvider) => {
      const database = createDb(':memory:')
      const guardrails = createGuardrails(createRepository(database))
      try {
        for await (const event of chat(request, { guardrails, provider })) {
          expect(['delta', 'done']).toContain(event.type)
        }
        return database.select().from(aiUsage).all()[0]
      } finally {
        guardrails.dispose()
      }
    }
    const estimated = await run({
      async *stream() {
        yield 'estimated reply'
      },
    })
    const malformed = await run({
      async *stream() {
        yield 'estimated reply'
        yield { type: 'usage', usage: { promptTokens: -1, completionTokens: 3 } }
      },
    })
    expect(malformed).toMatchObject({
      promptTokens: estimated.promptTokens,
      completionTokens: estimated.completionTokens,
    })
  })

  it('accounts for query and catalog embedding calls in separate budget reservations', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    mockRetrieveProducts.mockImplementation(
      async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
        const runEmbedding = options.runEmbedding as EmbeddingRunner
        await runEmbedding(['query text'], async () => [[1]])
        await runEmbedding(['catalog text'], async () => [[1]])
        return []
      },
    )
    try {
      const events = []
      for await (const event of chat({ ...request, mode: 'shopping' }, { guardrails })) {
        events.push(event)
      }
      expect(events).toEqual([
        {
          type: 'delta',
          text: "I couldn't find a style that matches that yet — try different words or browse the shop.",
        },
        { type: 'done' },
      ])
      const usage = database.select().from(aiUsage).all()
      expect(usage.filter((row) => row.model === 'embedding')).toHaveLength(2)
      expect(usage.filter((row) => row.model === 'embedding')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            promptTokens: 3,
            completionTokens: 0,
            sessionKey: request.sessionKey,
          }),
        ]),
      )
      expect(database.select().from(aiBudgetReservations).all()).toHaveLength(3)
      expect(database.select().from(aiBudgetDays).all()[0].reservedTokens).toBe(0)
    } finally {
      guardrails.dispose()
    }
  })

  it('keeps an embedding failure as abandoned cost before keyword fallback', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    mockRetrieveProducts.mockImplementation(
      async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
        const runEmbedding = options.runEmbedding as EmbeddingRunner
        await expect(
          runEmbedding(['query text'], async () => {
            throw new Error('embedding timeout')
          }),
        ).rejects.toThrow('embedding timeout')
        return []
      },
    )
    try {
      for await (const event of chat({ ...request, mode: 'shopping' }, { guardrails })) {
        expect(['delta', 'done']).toContain(event.type)
      }
      const reservations = database.select().from(aiBudgetReservations).all()
      expect(reservations.some((row) => row.status === 'abandoned')).toBe(true)
      expect(reservations.some((row) => row.status === 'settled')).toBe(true)
      expect(
        database
          .select()
          .from(aiUsage)
          .all()
          .some((row) => row.model === 'embedding'),
      ).toBe(false)
    } finally {
      guardrails.dispose()
    }
  })

  it('returns budget refusal when embedding admission is exhausted before provider work', async () => {
    vi.stubEnv('AI_DAILY_TOKEN_CAP', '1')
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const provider: AiProvider = { stream: vi.fn() }
    mockRetrieveProducts.mockImplementation(
      async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
        const runEmbedding = options.runEmbedding as EmbeddingRunner
        await runEmbedding(['query text'], async () => [[1]])
        return []
      },
    )
    try {
      const events = []
      for await (const event of chat({ ...request, mode: 'shopping' }, { guardrails, provider })) {
        events.push(event)
      }
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'error', code: 'budget' })
      expect(provider.stream).not.toHaveBeenCalled()
    } finally {
      guardrails.dispose()
    }
  })

  it('releases an unsuccessful deterministic reply that never invoked a provider', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    vi.spyOn(guardrails, 'settleBudget').mockRejectedValue(new Error('database failed'))
    const provider = { stream: vi.fn() }
    try {
      for await (const event of chat(
        {
          ...request,
          mode: 'size-fit',
          text: 'I wear US 9',
          product: { handle: 'dc-1001', title: 'Urban Bloom' },
        },
        { guardrails, provider },
      )) {
        expect(['sizeFit', 'delta', 'error']).toContain(event.type)
      }
      expect(provider.stream).not.toHaveBeenCalled()
      expect(database.select().from(aiBudgetReservations).all()[0].status).toBe('released')
      expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
        reservedTokens: 0,
        usedTokens: 0,
      })
    } finally {
      guardrails.dispose()
    }
  })

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
