// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashText, retrieve, type RetrievalDeps } from './retrieval'
import { searchableText } from '@/domain/search-text'
import { createDb } from '@/db/client'
import { createRepository, type Repository } from './repository'
import { seedProducts } from '@/server/catalog/seed'

// 嵌入能力与嵌入实现都由测试直接注入 —— 这正是本次重构的目的：不再 vi.mock 整个 ./embedder
// 模块，也不必靠 env 开关绕过模块级全局单例。
const mockEmbed = vi.fn()
const mockEmbeddingsAvailable = vi.fn()

const DIM = seedProducts.length // 商品数（随 seed 动态）
const FIRST = seedProducts[0]

const makeRepo = (): Repository => createRepository(createDb(':memory:'))

/** products 显式传入：生产由组合根（ai/retrieval-gateway）注入 catalog().getProducts({})。 */
const depsOf = (repo: Repository, over: Partial<RetrievalDeps> = {}): RetrievalDeps => ({
  products: seedProducts,
  repo,
  canEmbed: mockEmbeddingsAvailable,
  embed: mockEmbed,
  ...over,
})

describe('retrieve', () => {
  beforeEach(() => {
    mockEmbed.mockReset()
    mockEmbeddingsAvailable.mockReset()
    vi.stubEnv('AI_EMBEDDING_MODEL', 'test-model')
  })

  // 语义路径：mock embed 返回按 seed 内容 one-hot 的固定向量。
  // 支持批量入参（补齐逻辑现为一次请求补算全部缺失商品）。
  // 查询向量与首商品对齐 → 余弦 1，其余产品 0。
  function mockSemanticEmbed() {
    const contents = new Map(seedProducts.map((p) => [searchableText(p), p]))
    mockEmbed.mockImplementation(async (texts: string[]) =>
      texts.map((t) => {
        const hit = contents.get(t)
        if (!hit) return oneHot(0) // 查询串 → 对齐首商品
        const idx = seedProducts.findIndex((p) => p.id === hit.id)
        return oneHot(idx)
      }),
    )
  }

  const oneHot = (idx: number) => Array.from({ length: DIM }, (_, d) => (d === idx ? 1 : 0))

  it('无 embedding 能力时走关键词降级，且不调用 embed', async () => {
    mockEmbeddingsAvailable.mockResolvedValue(false)
    // avocado 仅出现在 26016-m 的色系描述里 → 单命中确定性断言
    const res = await retrieve('avocado', depsOf(makeRepo()))
    expect(mockEmbed).not.toHaveBeenCalled()
    expect(res).toEqual([{ handle: '26016-m', score: expect.any(Number) }])
    expect(res[0].score).toBeGreaterThan(0)
  })

  it('关键词降级返回形状 {handle,score} 且降序', async () => {
    mockEmbeddingsAvailable.mockResolvedValue(false)
    const res = await retrieve('sneaker', depsOf(makeRepo())) // productType 全目录含 sneaker
    expect(res.length).toBeGreaterThan(1)
    for (let i = 1; i < res.length; i++) {
      expect(res[i - 1].score).toBeGreaterThanOrEqual(res[i].score)
    }
  })

  it('关键词零命中返回空数组', async () => {
    mockEmbeddingsAvailable.mockResolvedValue(false)
    expect(await retrieve('zzzqwertyplokmnb', depsOf(makeRepo()))).toEqual([])
  })

  it('语义可用时懒嵌入缺失商品并缓存，余弦排序首位为查询对齐商品', async () => {
    mockEmbeddingsAvailable.mockResolvedValue(true)
    mockSemanticEmbed()
    const repo = makeRepo()

    const res = await retrieve('everyday breathable runner', depsOf(repo))

    // 1 次查询嵌入 + 1 次批量补齐嵌入（DIM 个商品一次请求）
    expect(mockEmbed).toHaveBeenCalledTimes(2)
    const batchCall = mockEmbed.mock.calls.find(([texts]) => (texts as string[]).length > 1)
    expect((batchCall?.[0] as string[]).length).toBe(DIM)
    expect(res).toHaveLength(DIM)
    expect(res[0].handle).toBe(FIRST.handle)
    expect(res[0].score).toBeCloseTo(1)

    // 缓存落库：每行 contentHash/model 与源一致
    const rows = await repo.allEmbeddings('test-model')
    expect(rows).toHaveLength(DIM)
    for (const p of seedProducts) {
      const row = rows.find((r) => r.productId === p.id)
      expect(row).toBeDefined()
      expect(row!.contentHash).toBe(hashText(searchableText(p)))
      expect(row!.model).toBe('test-model')
    }
  })

  it('缓存命中（contentHash 未变）时不重复嵌入', async () => {
    mockEmbeddingsAvailable.mockResolvedValue(true)
    mockSemanticEmbed()
    const repo = makeRepo()
    await retrieve('warmup query', depsOf(repo))
    expect(mockEmbed).toHaveBeenCalledTimes(2) // 查询 + 批量补齐

    await retrieve('warmup query', depsOf(repo))
    // 第二次仅查询嵌入（+1），16 商品全部命中缓存不再嵌入
    expect(mockEmbed).toHaveBeenCalledTimes(3)
  })

  it('contentHash 变化时仅重算该商品并刷新缓存', async () => {
    mockEmbeddingsAvailable.mockResolvedValue(true)
    mockSemanticEmbed()
    const repo = makeRepo()

    // 预置全部行正确哈希，仅首商品置为过期哈希
    for (const p of seedProducts) {
      await repo.upsertEmbedding({
        productId: p.id,
        contentHash: p.id === FIRST.id ? 'stale-hash' : hashText(searchableText(p)),
        model: 'test-model',
        vector: oneHot(seedProducts.findIndex((s) => s.id === p.id)),
      })
    }

    const res = await retrieve('everyday breathable runner', depsOf(repo))
    expect(mockEmbed).toHaveBeenCalledTimes(2) // 1 查询 + 批量补齐(仅首商品一个)
    expect((mockEmbed.mock.calls[1][0] as string[]).length).toBe(1)
    expect(res[0].handle).toBe(FIRST.handle)

    const rows = await repo.allEmbeddings('test-model')
    const firstRow = rows.find((r) => r.productId === FIRST.id)
    expect(firstRow!.contentHash).toBe(hashText(searchableText(seedProducts[0])))
  })
})
