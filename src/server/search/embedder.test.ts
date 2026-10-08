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
