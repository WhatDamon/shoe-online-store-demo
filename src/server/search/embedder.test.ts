// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedProducts } from '@/server/catalog/seed'

const { catalog, repository } = vi.hoisted(() => ({
  catalog: { getProducts: vi.fn(), getProductByHandle: vi.fn() },
  repository: { allEmbeddings: vi.fn(), upsertEmbedding: vi.fn() },
}))
vi.mock('@/server/catalog/adapter', () => ({ catalog: () => catalog }))
vi.mock('./repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repository')>()),
  createDefaultRepository: () => repository,
}))

const product = { ...seedProducts[0], title: 'Boundary sneaker' }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
  vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
  vi.stubEnv('AI_API_KEY', 'test-only-not-a-real-key')
  vi.stubEnv('AI_DISABLE_REAL', '0')
  catalog.getProducts.mockResolvedValue([product])
  catalog.getProductByHandle.mockResolvedValue(product)
  repository.allEmbeddings.mockResolvedValue([])
  repository.upsertEmbedding.mockResolvedValue(undefined)
  // Any unexpected call remains an observable spy, never real network traffic.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }))),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('bounded embedding responses', () => {
  it.each([
    ['missing data', {}],
    ['wrong count', { data: [] }],
    ['extra rows', { data: [{ embedding: [1] }, { embedding: [1] }] }],
    ['missing vector', { data: [{}] }],
    ['empty vector', { data: [{ embedding: [] }] }],
    ['string component', { data: [{ embedding: ['1'] }] }],
    ['null component', { data: [{ embedding: [null] }] }],
    ['zero norm', { data: [{ embedding: [0, 0] }] }],
    ['overflow norm', { data: [{ embedding: [1e308] }] }],
    ['underflow norm', { data: [{ embedding: [1e-300] }] }],
    ['out of range index', { data: [{ index: 1, embedding: [1] }] }],
  ])('rejects %s without exposing payload', async (_name, payload) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload)))
    const { embed } = await import('./embedder')
    await expect(embed(['query'])).rejects.toThrow('Invalid embedding response')
  })

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite component %s', async (component) => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [component] }] }),
    } as Response)
    const { embed } = await import('./embedder')
    await expect(embed(['query'])).rejects.toThrow('Invalid embedding response')
  })

  it.each([
    [{ embedding: [1] }, { embedding: [1, 0] }],
    [
      { index: 0, embedding: [1] },
      { index: 0, embedding: [1] },
    ],
    [{ index: 0, embedding: [1] }, { embedding: [1] }],
    [
      { index: 0.5, embedding: [1] },
      { index: 1, embedding: [1] },
    ],
  ])('rejects inconsistent batches (%#)', async (...data) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data })))
    const { embed } = await import('./embedder')
    await expect(embed(['a', 'b'])).rejects.toThrow('Invalid embedding response')
  })

  it('maps explicit response indexes back to input order', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      ),
    )
    const { embed } = await import('./embedder')
    await expect(embed(['a', 'b'])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ])
  })

  it('rejects pre-dispatch cancellation with explicit unused-cost proof', async () => {
    const controller = new AbortController()
    controller.abort(new Error('caller stopped'))
    const { embed, EmbeddingDispatchBlockedError } = await import('./embedder')
    await expect(embed(['query'], { signal: controller.signal })).rejects.toBeInstanceOf(
      EmbeddingDispatchBlockedError,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['headers', 'body'])('bounds stalled %s with the configured deadline', async (phase) => {
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '40')
    const pending = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const signal = init?.signal as AbortSignal
      // Keep a bounded baseline failure instead of waiting for the default test timeout.
      if (!signal) throw new Error('missing bounded request signal')
      if (phase === 'headers') return pending(signal)
      const response = new Response(null)
      response.json = () => pending(signal)
      return response
    })
    const { embed } = await import('./embedder')
    await expect(embed(['query'])).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['headers', 'body'])(
    'propagates in-flight caller cancellation during %s',
    async (phase) => {
      const controller = new AbortController()
      const reason = new Error('caller stopped')
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        const signal = init?.signal as AbortSignal
        if (!signal) throw new Error('missing caller signal')
        const pending = () =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            queueMicrotask(() => controller.abort(reason))
          })
        if (phase === 'headers') return pending()
        const response = new Response(null)
        response.json = pending
        return response
      })
      const { embed } = await import('./embedder')
      await expect(embed(['query'], { signal: controller.signal })).rejects.toBe(reason)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('does not cache cancelled probe success and permits a fresh probe', async () => {
    const controller = new AbortController()
    const reason = new Error('probe stopped')
    vi.mocked(fetch).mockImplementationOnce(async () => {
      controller.abort(reason)
      return new Response(null)
    })
    const { embeddingsAvailable } = await import('./embedder')
    await expect(embeddingsAvailable({ signal: controller.signal })).rejects.toBe(reason)
    await expect(embeddingsAvailable()).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('embedding capability probe', () => {
  it('preserves a budget refusal from its request wrapper', async () => {
    vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
    vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
    const refusal = Object.assign(new Error('daily cap'), { code: 'budget' })
    const { embeddingsAvailable } = await import('./embedder')

    await expect(
      embeddingsAvailable({
        run: async () => {
          throw refusal
        },
      }),
    ).rejects.toMatchObject({ code: 'budget' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('real AI kill switch at the embedding boundary', () => {
  it.each(['1', 'true', ' TRUE '])(
    'skips fresh probes and admission when disabled with %s',
    async (flag) => {
      vi.stubEnv('AI_DISABLE_REAL', flag)
      const run = vi.fn(async (operation: () => Promise<Response>) => operation())
      const { embeddingsAvailable } = await import('./embedder')

      await expect(embeddingsAvailable({ run })).resolves.toBe(false)
      expect(run).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each([200, 401])('overrides cached %s without poisoning restoration', async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }))
    const { embeddingsAvailable } = await import('./embedder')
    await expect(embeddingsAvailable()).resolves.toBe(status === 200)

    vi.stubEnv('AI_DISABLE_REAL', '1')
    const run = vi.fn(async (operation: () => Promise<Response>) => operation())
    await expect(embeddingsAvailable({ run })).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.stubEnv('AI_DISABLE_REAL', '0')
    await expect(embeddingsAvailable()).resolves.toBe(status === 200)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache a disabled result or prevent a later enabled probe', async () => {
    const { embeddingsAvailable } = await import('./embedder')
    vi.stubEnv('AI_DISABLE_REAL', '1')
    await expect(embeddingsAvailable()).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()

    vi.stubEnv('AI_DISABLE_REAL', '0')
    await expect(embeddingsAvailable()).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rechecks the switch after delayed probe admission and permits later recovery', async () => {
    const { embeddingsAvailable } = await import('./embedder')
    const run = vi.fn(async (operation: () => Promise<Response>) => {
      vi.stubEnv('AI_DISABLE_REAL', '1')
      return operation()
    })
    await expect(embeddingsAvailable({ run })).resolves.toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()

    vi.stubEnv('AI_DISABLE_REAL', '0')
    await expect(embeddingsAvailable()).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['1', 'true', ' TRUE '])(
    'rejects direct embedding before fetch with %s',
    async (flag) => {
      vi.stubEnv('AI_DISABLE_REAL', flag)
      const { embed } = await import('./embedder')
      await expect(embed(['private customer query'])).rejects.toThrow('Real AI is disabled')
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('retains enabled direct embedding and its request contract', async () => {
    const { embed } = await import('./embedder')
    await expect(embed(['sneaker'])).resolves.toEqual([[1, 0]])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      'https://embedding.example.test/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'test-embedding',
          input: ['sneaker'],
          encoding_format: 'float',
        }),
      }),
    )
  })

  it.each(['fresh', 'cached'])(
    'keeps real gateway/retrieval on keywords with %s capability',
    async (state) => {
      const { embeddingsAvailable } = await import('./embedder')
      if (state === 'cached') await expect(embeddingsAvailable()).resolves.toBe(true)
      vi.mocked(fetch).mockClear()
      vi.stubEnv('AI_DISABLE_REAL', '1')
      const admission = vi.fn()
      const { retrieveProducts } = await import('@/server/ai/retrieval-gateway')
      const runEmbedding: import('@/server/ai/retrieval-gateway').EmbeddingRunner = async (
        texts,
        operation,
      ) => {
        admission(texts)
        return operation()
      }

      await expect(retrieveProducts('sneaker', 4, { runEmbedding })).resolves.toEqual([product])
      expect(admission).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(repository.allEmbeddings).not.toHaveBeenCalled()
      expect(repository.upsertEmbedding).not.toHaveBeenCalled()
    },
  )
})
