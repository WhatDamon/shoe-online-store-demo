// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '@/db/client'
import { aiBudgetDays, aiBudgetReservations, aiUsage } from '@/db/schema'
import { createGuardrails } from '@/server/guardrails'
import { createRepository } from '@/server/search/repository'
import { embed, embeddingsAvailable, EmbeddingDispatchBlockedError } from '@/server/search/embedder'
import { chat, FALLBACK_ERROR_TEXT, type ChatRequest } from './chat'
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
  vi.stubEnv('CATALOG_SOURCE', 'seed')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('测试中出现未配置的 fetch 调用')
    }),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockRetrieveProducts.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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
          expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0] as string)).toMatchObject({
            event: 'ai_provider_failure',
            request_id: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            ),
          })
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

  it('将调用方 signal 原样传入 gateway options', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const controller = new AbortController()
    const provider: AiProvider = { stream: vi.fn() }
    mockRetrieveProducts.mockResolvedValue([])
    try {
      const events = []
      for await (const event of chat(
        { ...request, mode: 'shopping' },
        { guardrails, provider, signal: controller.signal },
      )) {
        events.push(event)
      }
      expect(mockRetrieveProducts).toHaveBeenCalledTimes(1)
      expect(mockRetrieveProducts).toHaveBeenCalledWith(
        request.text,
        undefined,
        expect.objectContaining({
          signal: controller.signal,
          runEmbedding: expect.any(Function),
        }),
      )
      expect(mockRetrieveProducts.mock.calls[0][2].signal).toBe(controller.signal)
      expect(events.at(-1)).toEqual({ type: 'done' })
      expect(provider.stream).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      guardrails.dispose()
    }
  })

  it('runEmbedding 在预占前发现取消时不创建预算或调用 operation', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const controller = new AbortController()
    const reserve = vi.spyOn(guardrails, 'reserveBudget')
    const operation = vi.fn(async () => [[1]])
    const provider: AiProvider = { stream: vi.fn() }
    const pushTurn = vi.spyOn(guardrails, 'pushTurn')
    mockRetrieveProducts.mockImplementation(
      async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
        controller.abort(new DOMException('检索开始后取消', 'AbortError'))
        await (options.runEmbedding as EmbeddingRunner)(['query text'], operation)
        return []
      },
    )
    try {
      const events = []
      for await (const event of chat(
        { ...request, mode: 'shopping' },
        { guardrails, provider, signal: controller.signal },
      )) {
        events.push(event)
      }
      expect(events).toEqual([{ type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }])
      expect(mockRetrieveProducts).toHaveBeenCalledTimes(1)
      expect(reserve).not.toHaveBeenCalled()
      expect(operation).not.toHaveBeenCalled()
      expect(provider.stream).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(database.select().from(aiBudgetReservations).all()).toEqual([])
      expect(database.select().from(aiBudgetDays).all()).toEqual([])
      expect(database.select().from(aiUsage).all()).toEqual([])
      expect(pushTurn).not.toHaveBeenCalled()
      expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
    } finally {
      guardrails.dispose()
    }
  })

  it('在 reserve await 期间取消时释放预占，actualTokens 为 0 且不调用 operation', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const controller = new AbortController()
    const reserveBudget = guardrails.reserveBudget.bind(guardrails)
    const pendingStates: string[] = []
    const reserve = vi
      .spyOn(guardrails, 'reserveBudget')
      .mockImplementationOnce(async (...args) => {
        await reserveBudget(...args)
        pendingStates.push(database.select().from(aiBudgetReservations).all()[0].status)
        // 内存预占已完成，调用方的 reserve await 尚未恢复。
        controller.abort(new DOMException('预占期间取消', 'AbortError'))
      })
    const release = vi.spyOn(guardrails, 'releaseBudget')
    const abandon = vi.spyOn(guardrails, 'abandonBudget')
    const settle = vi.spyOn(guardrails, 'settleBudget')
    const pushTurn = vi.spyOn(guardrails, 'pushTurn')
    const operation = vi.fn(async () => [[1]])
    const embeddingFailure = vi.fn()
    const provider: AiProvider = { stream: vi.fn() }
    mockRetrieveProducts.mockImplementation(
      async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
        const runEmbedding = options.runEmbedding as EmbeddingRunner
        await runEmbedding(['query text'], operation).catch((error) => {
          embeddingFailure(error)
          throw error
        })
        return []
      },
    )
    try {
      const events = []
      for await (const event of chat(
        { ...request, mode: 'shopping' },
        { guardrails, provider, signal: controller.signal },
      )) {
        events.push(event)
      }
      expect(events).toEqual([{ type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }])
      expect(pendingStates).toEqual(['pending'])
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(embeddingFailure).toHaveBeenCalledTimes(1)
      expect(embeddingFailure.mock.calls[0][0]).toBeInstanceOf(EmbeddingDispatchBlockedError)
      expect(operation).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(provider.stream).not.toHaveBeenCalled()
      const reservations = database.select().from(aiBudgetReservations).all()
      expect(reservations).toHaveLength(1)
      expect(reservations[0]).toMatchObject({
        status: 'released',
        reservedTokens: 3,
        actualTokens: 0,
      })
      expect(release).toHaveBeenCalledExactlyOnceWith(reservations[0].requestId)
      expect(abandon).not.toHaveBeenCalled()
      expect(settle).not.toHaveBeenCalled()
      expect(database.select().from(aiBudgetDays).all()).toEqual([
        expect.objectContaining({ reservedTokens: 0, usedTokens: 0 }),
      ])
      expect(database.select().from(aiUsage).all()).toEqual([])
      expect(pushTurn).not.toHaveBeenCalled()
      expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
    } finally {
      guardrails.dispose()
    }
  })

  it('真实 embed 在 operation 内发现发送前取消时用明确错误释放预算', async () => {
    vi.stubEnv('AI_DISABLE_REAL', '0')
    vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
    vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const controller = new AbortController()
    const release = vi.spyOn(guardrails, 'releaseBudget')
    const abandon = vi.spyOn(guardrails, 'abandonBudget')
    const settle = vi.spyOn(guardrails, 'settleBudget')
    const provider: AiProvider = { stream: vi.fn() }
    const embeddingFailure = vi.fn()
    const operation = vi.fn(async () => {
      controller.abort(new DOMException('发送前取消', 'AbortError'))
      return embed(['query text'], { signal: controller.signal })
    })
    mockRetrieveProducts.mockImplementation(
      async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
        const runEmbedding = options.runEmbedding as EmbeddingRunner
        await runEmbedding(['query text'], operation).catch((error) => {
          embeddingFailure(error)
          throw error
        })
        return []
      },
    )
    try {
      const events = []
      for await (const event of chat(
        { ...request, mode: 'shopping' },
        { guardrails, provider, signal: controller.signal },
      )) {
        events.push(event)
      }
      expect(events).toEqual([{ type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }])
      expect(operation).toHaveBeenCalledTimes(1)
      expect(embeddingFailure).toHaveBeenCalledTimes(1)
      expect(embeddingFailure.mock.calls[0][0]).toBeInstanceOf(EmbeddingDispatchBlockedError)
      expect(fetch).not.toHaveBeenCalled()
      expect(provider.stream).not.toHaveBeenCalled()
      const reservations = database.select().from(aiBudgetReservations).all()
      expect(reservations).toHaveLength(1)
      expect(reservations[0]).toMatchObject({
        status: 'released',
        reservedTokens: 3,
        actualTokens: 0,
      })
      expect(release).toHaveBeenCalledExactlyOnceWith(reservations[0].requestId)
      expect(abandon).not.toHaveBeenCalled()
      expect(settle).not.toHaveBeenCalled()
      expect(database.select().from(aiBudgetDays).all()).toEqual([
        expect.objectContaining({ reservedTokens: 0, usedTokens: 0 }),
      ])
      expect(database.select().from(aiUsage).all()).toEqual([])
      expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
    } finally {
      guardrails.dispose()
    }
  })

  it('真实 embed 已进入 fetch await 后调用方取消时保守 abandon 且不完成 chat 回合', async () => {
    vi.stubEnv('AI_DISABLE_REAL', '0')
    vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
    vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const controller = new AbortController()
    const reason = new DOMException('调用方取消已发送的请求', 'AbortError')
    const release = vi.spyOn(guardrails, 'releaseBudget')
    const abandon = vi.spyOn(guardrails, 'abandonBudget')
    const settle = vi.spyOn(guardrails, 'settleBudget')
    const pushTurn = vi.spyOn(guardrails, 'pushTurn')
    const provider: AiProvider = { stream: vi.fn() }
    const embeddingFailure = vi.fn()
    let notifyFetch!: () => void
    const dispatched = new Promise<void>((resolve) => {
      notifyFetch = resolve
    })
    let resumeFetch!: () => void
    const fetchWait = new Promise<void>((resolve) => {
      resumeFetch = resolve
    })
    const dispatchAborted: Array<boolean | undefined> = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      dispatchAborted.push(init?.signal?.aborted)
      notifyFetch()
      await fetchWait
      init?.signal?.throwIfAborted()
      return new Response(JSON.stringify({ data: [{ embedding: [1] }] }))
    })
    vi.stubGlobal('fetch', fetcher)
    mockRetrieveProducts.mockImplementation(
      async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
        await (options.runEmbedding as EmbeddingRunner)(['query text'], (dispatch) =>
          embed(['query text'], { ...dispatch, signal: options.signal }),
        ).catch((error) => {
          embeddingFailure(error)
          throw error
        })
        return []
      },
    )
    const stream = chat(
      { ...request, mode: 'shopping' },
      { guardrails, provider, signal: controller.signal },
    )
    const firstEvent = stream.next()
    try {
      await Promise.race([
        dispatched,
        firstEvent.then(() => {
          throw new Error('chat 在进入 fetch 前已结束')
        }),
      ])
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(dispatchAborted).toEqual([false])
      expect(database.select().from(aiBudgetReservations).all()).toEqual([
        expect.objectContaining({ status: 'pending', reservedTokens: 3, actualTokens: 0 }),
      ])
      expect(database.select().from(aiBudgetDays).all()).toEqual([
        expect.objectContaining({ reservedTokens: 3, usedTokens: 0 }),
      ])
      expect(provider.stream).not.toHaveBeenCalled()
      controller.abort(reason)
      resumeFetch()
      expect(await firstEvent).toEqual({
        done: false,
        value: { type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT },
      })
      expect(await stream.next()).toEqual({ done: true, value: undefined })
      expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
      expect(fetcher.mock.calls[0][1]?.signal?.reason).toBe(reason)
      expect(embeddingFailure).toHaveBeenCalledTimes(1)
      expect(embeddingFailure.mock.calls[0][0]).toMatchObject({ name: 'AbortError' })
      expect(embeddingFailure.mock.calls[0][0]).not.toBeInstanceOf(EmbeddingDispatchBlockedError)
      const reservations = database.select().from(aiBudgetReservations).all()
      expect(reservations).toHaveLength(1)
      expect(reservations[0]).toMatchObject({
        status: 'abandoned',
        reservedTokens: 3,
        actualTokens: 3,
      })
      expect(abandon).toHaveBeenCalledExactlyOnceWith(reservations[0].requestId)
      expect(release).not.toHaveBeenCalled()
      expect(settle).not.toHaveBeenCalled()
      expect(database.select().from(aiBudgetDays).all()).toEqual([
        expect.objectContaining({ reservedTokens: 0, usedTokens: 3 }),
      ])
      expect(provider.stream).not.toHaveBeenCalled()
      expect(database.select().from(aiUsage).all()).toEqual([])
      expect(pushTurn).not.toHaveBeenCalled()
      expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
    } finally {
      resumeFetch()
      await stream.return(undefined)
      guardrails.dispose()
    }
  })

  it.each(['TimeoutError', 'invalid payload'])(
    '真实 embed 的 fetch 后 %s 仍保守 abandon',
    async (failure) => {
      vi.stubEnv('AI_DISABLE_REAL', '0')
      vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
      vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
      const database = createDb(':memory:')
      const guardrails = createGuardrails(createRepository(database))
      const release = vi.spyOn(guardrails, 'releaseBudget')
      const abandon = vi.spyOn(guardrails, 'abandonBudget')
      const settle = vi.spyOn(guardrails, 'settleBudget')
      const provider: AiProvider = { stream: vi.fn() }
      const embeddingFailure = vi.fn()
      const fetcher = vi.fn(async () => {
        await Promise.resolve()
        if (failure === 'TimeoutError') throw new DOMException('发送后超时', 'TimeoutError')
        return new Response(JSON.stringify({ data: [{ embedding: [null] }] }))
      })
      vi.stubGlobal('fetch', fetcher)
      mockRetrieveProducts.mockImplementation(
        async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
          await (options.runEmbedding as EmbeddingRunner)(['query text'], (dispatch) =>
            embed(['query text'], { ...dispatch, signal: options.signal }),
          ).catch((error) => {
            embeddingFailure(error)
            throw error
          })
          return []
        },
      )
      try {
        const events = []
        for await (const event of chat(
          { ...request, mode: 'shopping' },
          { guardrails, provider },
        )) {
          events.push(event)
        }
        expect(events).toEqual([{ type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }])
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(embeddingFailure).toHaveBeenCalledTimes(1)
        expect(embeddingFailure.mock.calls[0][0]).toBeInstanceOf(Error)
        expect(embeddingFailure.mock.calls[0][0]).not.toBeInstanceOf(EmbeddingDispatchBlockedError)
        if (failure === 'TimeoutError') {
          expect(embeddingFailure.mock.calls[0][0]).toMatchObject({ name: 'TimeoutError' })
        }
        const reservations = database.select().from(aiBudgetReservations).all()
        expect(reservations).toHaveLength(1)
        expect(reservations[0]).toMatchObject({
          status: 'abandoned',
          reservedTokens: 3,
          actualTokens: 3,
        })
        expect(abandon).toHaveBeenCalledExactlyOnceWith(reservations[0].requestId)
        expect(release).not.toHaveBeenCalled()
        expect(settle).not.toHaveBeenCalled()
        expect(database.select().from(aiBudgetDays).all()).toEqual([
          expect.objectContaining({ reservedTokens: 0, usedTokens: 3 }),
        ])
        expect(provider.stream).not.toHaveBeenCalled()
        expect(database.select().from(aiUsage).all()).toEqual([])
        expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
      } finally {
        guardrails.dispose()
      }
    },
  )

  it.each(['Error', 'AbortError', 'EmbeddingDispatchBlockedError'])(
    'embedding 成功但结算抛出 %s 时保守 abandon，不释放已发生的成本',
    async (failure) => {
      vi.stubEnv('AI_DISABLE_REAL', '0')
      vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
      vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
      const database = createDb(':memory:')
      const guardrails = createGuardrails(createRepository(database))
      const settlementError =
        failure === 'AbortError'
          ? new DOMException('账本结算被取消', 'AbortError')
          : failure === 'EmbeddingDispatchBlockedError'
            ? new EmbeddingDispatchBlockedError('账本结算失败')
            : new Error('账本结算失败')
      const settle = vi.spyOn(guardrails, 'settleBudget').mockRejectedValueOnce(settlementError)
      const release = vi.spyOn(guardrails, 'releaseBudget')
      const abandon = vi.spyOn(guardrails, 'abandonBudget')
      const provider: AiProvider = { stream: vi.fn() }
      const embeddingFailure = vi.fn()
      const fetcher = vi.fn(
        async () => new Response(JSON.stringify({ data: [{ embedding: [1] }] })),
      )
      vi.stubGlobal('fetch', fetcher)
      mockRetrieveProducts.mockImplementation(
        async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
          await (options.runEmbedding as EmbeddingRunner)(['query text'], (dispatch) =>
            embed(['query text'], { ...dispatch, signal: options.signal }),
          ).catch((error) => {
            embeddingFailure(error)
            throw error
          })
          return []
        },
      )
      try {
        const events = []
        for await (const event of chat(
          { ...request, mode: 'shopping' },
          { guardrails, provider },
        )) {
          events.push(event)
        }
        expect(events).toEqual([{ type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }])
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(embeddingFailure).toHaveBeenCalledExactlyOnceWith(settlementError)
        const reservations = database.select().from(aiBudgetReservations).all()
        expect(reservations).toHaveLength(1)
        expect(reservations[0]).toMatchObject({
          status: 'abandoned',
          reservedTokens: 3,
          actualTokens: 3,
        })
        expect(settle).toHaveBeenCalledExactlyOnceWith(
          reservations[0].requestId,
          expect.objectContaining({
            model: 'test-embedding',
            promptTokens: 3,
            completionTokens: 0,
          }),
        )
        expect(abandon).toHaveBeenCalledExactlyOnceWith(reservations[0].requestId)
        expect(release).not.toHaveBeenCalled()
        expect(database.select().from(aiBudgetDays).all()).toEqual([
          expect.objectContaining({ reservedTokens: 0, usedTokens: 3 }),
        ])
        expect(provider.stream).not.toHaveBeenCalled()
        expect(database.select().from(aiUsage).all()).toEqual([])
        expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
      } finally {
        guardrails.dispose()
      }
    },
  )

  it.each(['embedding timeout', 'Real AI is disabled'])(
    'keeps an ordinary embedding error "%s" as abandoned cost before fallback',
    async (message) => {
      const database = createDb(':memory:')
      const guardrails = createGuardrails(createRepository(database))
      mockRetrieveProducts.mockImplementation(
        async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
          const runEmbedding = options.runEmbedding as EmbeddingRunner
          await expect(
            runEmbedding(['query text'], async () => {
              throw new Error(message)
            }),
          ).rejects.toThrow(message)
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
    },
  )

  it.each(['probe', 'query'])(
    'releases a %s reservation when the kill switch blocks dispatch',
    async (kind) => {
      vi.stubEnv('AI_DISABLE_REAL', '0')
      vi.stubEnv('AI_API_KEY', '')
      vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
      vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
      const database = createDb(':memory:')
      const guardrails = createGuardrails(createRepository(database))
      const reserve = guardrails.reserveBudget.bind(guardrails)
      vi.spyOn(guardrails, 'reserveBudget').mockImplementation(async (...args) => {
        await reserve(...args)
        vi.stubEnv('AI_DISABLE_REAL', '1')
      })
      const fetcher = vi.fn(
        async () => new Response(JSON.stringify({ data: [{ embedding: [1] }] })),
      )
      vi.stubGlobal('fetch', fetcher)
      mockRetrieveProducts.mockImplementation(
        async (_query: string, _limit: number | undefined, options: RetrievalOptions) => {
          const runEmbedding = options.runEmbedding as EmbeddingRunner
          if (kind === 'probe') {
            await embeddingsAvailable({
              run: (operation) => runEmbedding(['ping'], operation),
              signal: options.signal,
            })
          } else {
            await runEmbedding(['customer query'], () =>
              embed(['customer query'], { signal: options.signal }),
            ).catch(() => {})
          }
          return []
        },
      )
      try {
        const events = []
        for await (const event of chat({ ...request, mode: 'shopping' }, { guardrails })) {
          events.push(event)
        }
        expect(events.at(-1)).toEqual({ type: 'done' })
        expect(fetcher).not.toHaveBeenCalled()
        const reservations = database.select().from(aiBudgetReservations).all()
        expect(reservations).toHaveLength(2)
        expect(reservations[0]).toMatchObject({ status: 'released', actualTokens: 0 })
        expect(reservations[1].status).toBe('settled')
        const day = database.select().from(aiBudgetDays).all()[0]
        expect(day).toMatchObject({ reservedTokens: 0, usedTokens: reservations[1].actualTokens })
        expect(database.select().from(aiUsage).all()).toHaveLength(1)
      } finally {
        vi.unstubAllGlobals()
        guardrails.dispose()
      }
    },
  )

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
