// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedProducts } from '@/server/catalog/seed'
import { retrieveProducts, type EmbeddingRunner } from './retrieval-gateway'

const { mockCatalog, mockEmbeddingsAvailable, mockEmbed, mockRetrieve } = vi.hoisted(() => ({
  mockCatalog: { getProducts: vi.fn(), getProductByHandle: vi.fn() },
  mockEmbeddingsAvailable: vi.fn(),
  mockEmbed: vi.fn(),
  mockRetrieve: vi.fn(),
}))

vi.mock('@/server/catalog/adapter', () => ({ catalog: () => mockCatalog }))
vi.mock('@/server/search/embedder', () => ({
  embed: mockEmbed,
  embeddingsAvailable: mockEmbeddingsAvailable,
}))
vi.mock('@/server/search/repository', () => ({ createDefaultRepository: () => ({}) }))
vi.mock('@/server/search/retrieval', () => ({ retrieve: mockRetrieve }))

const product = seedProducts[0]

beforeEach(() => {
  mockCatalog.getProducts.mockResolvedValue([product])
  mockCatalog.getProductByHandle.mockResolvedValue(product)
  mockEmbeddingsAvailable.mockImplementation(
    async ({ run }: { run?: (operation: () => Promise<Response>) => Promise<Response> }) => {
      const response = await run!(async () => new Response(null, { status: 200 }))
      return response.ok
    },
  )
  mockEmbed.mockResolvedValue([[1]])
  mockRetrieve.mockImplementation(
    async (
      _query: string,
      deps: { canEmbed: () => Promise<boolean>; embed: (texts: string[]) => Promise<number[][]> },
    ) => {
      if (await deps.canEmbed()) await deps.embed(['query text'])
      return [{ handle: product.handle, score: 1 }]
    },
  )
})

describe('retrieval gateway embedding budget seam', () => {
  it('passes the budget wrapper to both the capability probe and embedding request', async () => {
    const calls: string[][] = []
    const runEmbedding: EmbeddingRunner = async (texts, operation) => {
      calls.push(texts)
      return operation()
    }

    await expect(retrieveProducts('find a shoe', 4, { runEmbedding })).resolves.toEqual([product])
    expect(calls).toEqual([['ping'], ['query text']])
    expect(mockEmbed).toHaveBeenCalledWith(['query text'])
  })
})
