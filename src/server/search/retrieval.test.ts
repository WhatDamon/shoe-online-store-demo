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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

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

  it.each([new Error('caller cancelled'), { message: 'private-cancel-marker' }, null])(
    '调用前已取消时原样传播原因且不检查嵌入能力 (%#)',
    async (reason) => {
      const controller = new AbortController()
      controller.abort(reason)
      const repo = makeRepo()
      const read = vi.spyOn(repo, 'allEmbeddings')
      const upsert = vi.spyOn(repo, 'upsertEmbedding')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        mockEmbeddingsAvailable.mockResolvedValue(true)
        mockSemanticEmbed()

        await expect(retrieve('avocado', depsOf(repo, { signal: controller.signal }))).rejects.toBe(
          reason,
        )
        expect(mockEmbeddingsAvailable).not.toHaveBeenCalled()
        expect(mockEmbed).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
        expect(upsert).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
      } finally {
        read.mockRestore()
        upsert.mockRestore()
        warn.mockRestore()
      }
    },
  )

  it.each([true, false])('等待 canEmbed 时取消不继续检索（能力结果 %s）', async (available) => {
    const controller = new AbortController()
    const reason = new Error('caller cancelled during capability check')
    const started = deferred<void>()
    const capability = deferred<boolean>()
    const repo = makeRepo()
    const read = vi.spyOn(repo, 'allEmbeddings')
    const upsert = vi.spyOn(repo, 'upsertEmbedding')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockImplementation(() => {
        started.resolve(undefined)
        return capability.promise
      })
      mockSemanticEmbed()
      const result = expect(
        retrieve('avocado', depsOf(repo, { signal: controller.signal })),
      ).rejects.toBe(reason)
      await started.promise
      controller.abort(reason)
      capability.resolve(available)
      await result

      expect(mockEmbeddingsAvailable).toHaveBeenCalledTimes(1)
      expect(mockEmbed).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      upsert.mockRestore()
      warn.mockRestore()
    }
  })

  it('query 嵌入 resolve 后取消不读取缓存', async () => {
    const controller = new AbortController()
    const reason = new Error('caller cancelled after query embedding')
    const started = deferred<void>()
    const query = deferred<number[][]>()
    const repo = makeRepo()
    const read = vi.spyOn(repo, 'allEmbeddings')
    const upsert = vi.spyOn(repo, 'upsertEmbedding')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockSemanticEmbed()
      mockEmbed.mockImplementationOnce(() => {
        started.resolve(undefined)
        return query.promise
      })
      const result = expect(
        retrieve('avocado', depsOf(repo, { signal: controller.signal })),
      ).rejects.toBe(reason)
      await started.promise
      query.resolve([oneHot(0)])
      controller.abort(reason)
      await result

      expect(mockEmbed).toHaveBeenCalledTimes(1)
      expect(read).not.toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      upsert.mockRestore()
      warn.mockRestore()
    }
  })

  it('batch 嵌入 resolve 后取消不写入任何缓存且不再次读取缓存', async () => {
    const controller = new AbortController()
    const reason = new Error('caller cancelled after batch embedding')
    const started = deferred<void>()
    const batch = deferred<number[][]>()
    const repo = makeRepo()
    const read = vi.spyOn(repo, 'allEmbeddings')
    const upsert = vi.spyOn(repo, 'upsertEmbedding')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockSemanticEmbed()
      mockEmbed.mockResolvedValueOnce([oneHot(0)]).mockImplementationOnce(() => {
        started.resolve(undefined)
        return batch.promise
      })
      const result = expect(
        retrieve('avocado', depsOf(repo, { signal: controller.signal })),
      ).rejects.toBe(reason)
      await started.promise
      batch.resolve(seedProducts.map((_, idx) => oneHot(idx)))
      controller.abort(reason)
      await result

      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect(read).toHaveBeenCalledTimes(1)
      expect(upsert).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      upsert.mockRestore()
      warn.mockRestore()
    }
  })

  it.each(['成功', '失败'])('缓存读取%s后取消原样传播原因且不降级', async (outcome) => {
    const controller = new AbortController()
    const reason = new Error('caller cancelled after cache read')
    const started = deferred<void>()
    const cached = deferred<Awaited<ReturnType<Repository['allEmbeddings']>>>()
    const repo = makeRepo()
    const read = vi.spyOn(repo, 'allEmbeddings').mockImplementationOnce(() => {
      started.resolve(undefined)
      return cached.promise
    })
    const upsert = vi.spyOn(repo, 'upsertEmbedding')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockSemanticEmbed()
      const result = expect(
        retrieve('avocado', depsOf(repo, { signal: controller.signal })),
      ).rejects.toBe(reason)
      await started.promise
      if (outcome === '成功') cached.resolve([])
      else cached.reject(new Error('private-cache-failure-marker'))
      controller.abort(reason)
      await result

      expect(mockEmbed).toHaveBeenCalledTimes(1)
      expect(read).toHaveBeenCalledTimes(1)
      expect(upsert).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      upsert.mockRestore()
      warn.mockRestore()
    }
  })

  it('预算拒绝不会被吞掉为关键词降级', async () => {
    mockEmbeddingsAvailable.mockResolvedValue(true)
    mockEmbed.mockRejectedValue(Object.assign(new Error('daily cap'), { code: 'budget' }))

    await expect(retrieve('sneaker', depsOf(makeRepo()))).rejects.toMatchObject({ code: 'budget' })
  })

  it.each([
    new Error('private-marker postgres://user:password@internal/db'),
    { message: 'private-marker', token: 'private-token' },
    null,
  ])('降级只记录安全事件，不读取或输出异常内容 (%#)', async (failure) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockEmbed.mockRejectedValue(failure)

      expect(await retrieve('avocado', depsOf(makeRepo()))).toEqual([
        { handle: '26016-m', score: expect.any(Number) },
      ])
      expect(warn.mock.calls).toEqual([
        [JSON.stringify({ event: 'retrieval_fallback', strategy: 'keyword' })],
      ])
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private')
    } finally {
      warn.mockRestore()
    }
  })

  it('异常 getter 和序列化钩子不会在降级时执行', async () => {
    const inspect = vi.fn(() => {
      throw new Error('private-inspection-marker')
    })
    const failure = Object.defineProperties(
      {},
      {
        code: { get: inspect },
        message: { get: inspect },
        toJSON: { value: inspect },
        toString: { value: inspect },
      },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockEmbed.mockRejectedValue(failure)
      expect(await retrieve('avocado', depsOf(makeRepo()))).toEqual([
        { handle: '26016-m', score: expect.any(Number) },
      ])
      expect(inspect).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        JSON.stringify({ event: 'retrieval_fallback', strategy: 'keyword' }),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('撤销的 Proxy 异常仍可安全降级', async () => {
    const failure = Proxy.revocable({}, {})
    failure.revoke()
    mockEmbeddingsAvailable.mockResolvedValue(true)
    mockEmbed.mockRejectedValue(failure.proxy)
    expect(await retrieve('avocado', depsOf(makeRepo()))).toEqual([
      { handle: '26016-m', score: expect.any(Number) },
    ])
  })

  it('商品批量嵌入失败不执行 message getter', async () => {
    const inspect = vi.fn(() => {
      throw Object.assign(new Error('private-marker'), { code: 'budget' })
    })
    mockEmbeddingsAvailable.mockResolvedValue(true)
    mockEmbed.mockResolvedValueOnce([oneHot(0)])
    mockEmbed.mockRejectedValueOnce(Object.defineProperty({}, 'message', { get: inspect }))
    expect(await retrieve('avocado', depsOf(makeRepo()))).toEqual([
      { handle: '26016-m', score: expect.any(Number) },
    ])
    expect(inspect).not.toHaveBeenCalled()
    expect(mockEmbed).toHaveBeenCalledTimes(2)
  })

  it('批量预算拒绝即使含 429 也不得重试', async () => {
    const refusal = Object.assign(new Error('429 daily cap'), { code: 'budget' })
    vi.useFakeTimers()
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockEmbed.mockResolvedValueOnce([oneHot(0)]).mockRejectedValue(refusal)
      const result = expect(retrieve('avocado', depsOf(makeRepo()))).rejects.toBe(refusal)
      await vi.runAllTimersAsync()
      await result
      expect(mockEmbed).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('瞬时失败后的重试预算拒绝原样传播且不记录降级', async () => {
    const refusal = Object.assign(new Error('daily cap'), { code: 'budget' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockEmbed
        .mockResolvedValueOnce([oneHot(0)])
        .mockRejectedValueOnce(new Error('429 overloaded'))
        .mockRejectedValueOnce(refusal)
      const result = expect(retrieve('avocado', depsOf(makeRepo()))).rejects.toBe(refusal)
      await vi.runAllTimersAsync()
      await result
      expect(mockEmbed).toHaveBeenCalledTimes(3)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  it.each([null, undefined])('批量嵌入抛空值仍降级且不重试 (%#)', async (failure) => {
    mockEmbeddingsAvailable.mockResolvedValue(true)
    mockEmbed.mockResolvedValueOnce([oneHot(0)]).mockRejectedValueOnce(failure)
    expect(await retrieve('avocado', depsOf(makeRepo()))).toEqual([
      { handle: '26016-m', score: expect.any(Number) },
    ])
    expect(mockEmbed).toHaveBeenCalledTimes(2)
  })

  it.each(['429 overloaded', '503 unavailable'])('瞬时批量失败只重试一次 (%s)', async (message) => {
    vi.useFakeTimers()
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockEmbed.mockResolvedValueOnce([oneHot(0)]).mockRejectedValue(new Error(message))
      const result = retrieve('avocado', depsOf(makeRepo()))
      await vi.runAllTimersAsync()
      expect(await result).toEqual([{ handle: '26016-m', score: expect.any(Number) }])
      expect(mockEmbed).toHaveBeenCalledTimes(3)
      expect(mockEmbed.mock.calls.slice(1).map((call) => call[1])).toEqual([DIM, DIM])
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['429 overloaded', '503 unavailable'])(
    '批量 %s 的重试等待中取消及时完成且不发起二次 batch',
    async (message) => {
      const controller = new AbortController()
      const reason = { message: 'private-retry-cancel-marker' }
      const repo = makeRepo()
      const read = vi.spyOn(repo, 'allEmbeddings')
      const upsert = vi.spyOn(repo, 'upsertEmbedding')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const resolved = vi.fn()
      const rejected = vi.fn()
      vi.useFakeTimers()
      try {
        mockEmbeddingsAvailable.mockResolvedValue(true)
        mockSemanticEmbed()
        mockEmbed.mockResolvedValueOnce([oneHot(0)]).mockRejectedValueOnce(new Error(message))
        const result = retrieve('avocado', depsOf(repo, { signal: controller.signal })).then(
          resolved,
          rejected,
        )
        await vi.advanceTimersByTimeAsync(0)
        expect(mockEmbed).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(600)
        expect(resolved).not.toHaveBeenCalled()
        expect(rejected).not.toHaveBeenCalled()

        controller.abort(reason)
        await vi.advanceTimersByTimeAsync(0)
        // 未走完 1200ms 退避，取消已经完成；不能等到重试定时器触发才处理。
        expect(rejected).toHaveBeenCalledTimes(1)
        expect(rejected.mock.calls[0][0]).toBe(reason)
        expect(resolved).not.toHaveBeenCalled()
        await result
        expect(mockEmbed).toHaveBeenCalledTimes(2)
        expect(read).toHaveBeenCalledTimes(1)
        expect(upsert).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1_200)
        expect(mockEmbed).toHaveBeenCalledTimes(2)
        expect(read).toHaveBeenCalledTimes(1)
        expect(upsert).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
        read.mockRestore()
        upsert.mockRestore()
        warn.mockRestore()
      }
    },
  )

  it.each([
    { kind: '数量不足', vectors: [] },
    {
      kind: '数量过多',
      vectors: [
        [1, 0],
        [0, 1],
      ],
    },
    { kind: '空向量', vectors: [[]] },
    { kind: 'NaN', vectors: [[1, Number.NaN]] },
    { kind: '正无穷', vectors: [[1, Number.POSITIVE_INFINITY]] },
    { kind: '负无穷', vectors: [[1, Number.NEGATIVE_INFINITY]] },
    { kind: '非数值元素', vectors: [['private-vector-marker', 1]] },
    { kind: '零向量', vectors: [[0, 0]] },
    { kind: '非有限范数', vectors: [[Number.MAX_VALUE, Number.MAX_VALUE]] },
  ])('query 嵌入 $kind 时安全降级且零缓存写入', async ({ vectors }) => {
    const repo = makeRepo()
    const read = vi.spyOn(repo, 'allEmbeddings')
    const upsert = vi.spyOn(repo, 'upsertEmbedding')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockSemanticEmbed()
      mockEmbed.mockResolvedValueOnce(vectors)

      expect(await retrieve('avocado', depsOf(repo))).toEqual([
        { handle: '26016-m', score: expect.any(Number) },
      ])
      expect(mockEmbed).toHaveBeenCalledTimes(1)
      expect(read).not.toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
      expect(warn.mock.calls).toEqual([
        [JSON.stringify({ event: 'retrieval_fallback', strategy: 'keyword' })],
      ])
    } finally {
      read.mockRestore()
      upsert.mockRestore()
      warn.mockRestore()
    }
  })

  it.each([
    { kind: '空批次', change: () => [] },
    { kind: '数量不足', change: (vectors: number[][]) => vectors.slice(0, -1) },
    { kind: '数量过多', change: (vectors: number[][]) => [...vectors, oneHot(0)] },
    { kind: '末尾空向量', change: (vectors: number[][]) => [...vectors.slice(0, -1), []] },
    {
      kind: '末尾 NaN',
      change: (vectors: number[][]) => [
        ...vectors.slice(0, -1),
        oneHot(DIM - 1).map((n, idx) => (idx === 0 ? Number.NaN : n)),
      ],
    },
    {
      kind: '末尾非有限数',
      change: (vectors: number[][]) => [
        ...vectors.slice(0, -1),
        oneHot(DIM - 1).map((n, idx) => (idx === 0 ? Number.POSITIVE_INFINITY : n)),
      ],
    },
    {
      kind: '末尾非数值元素',
      change: (vectors: number[][]) => [
        ...vectors.slice(0, -1),
        oneHot(DIM - 1).map((n, idx) => (idx === 0 ? 'private-vector-marker' : n)),
      ],
    },
    {
      kind: '末尾零向量',
      change: (vectors: number[][]) => [
        ...vectors.slice(0, -1),
        Array.from({ length: DIM }, () => 0),
      ],
    },
    {
      kind: '末尾非有限范数',
      change: (vectors: number[][]) => [
        ...vectors.slice(0, -1),
        Array.from({ length: DIM }, () => Number.MAX_VALUE),
      ],
    },
    {
      kind: '批内维度不一致',
      change: (vectors: number[][]) => [...vectors.slice(0, -1), [...oneHot(DIM - 1), 0]],
    },
    {
      kind: '整批维度与 query 不一致',
      change: (vectors: number[][]) => vectors.map((vector) => [...vector, 0]),
    },
  ])('batch 嵌入 $kind 时整批拒绝并安全降级且零缓存写入', async ({ change }) => {
    const repo = makeRepo()
    const read = vi.spyOn(repo, 'allEmbeddings')
    const upsert = vi.spyOn(repo, 'upsertEmbedding')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockEmbeddingsAvailable.mockResolvedValue(true)
      mockSemanticEmbed()
      // 保留合法前缀，把损坏向量放到末尾；逐条校验并写入会被零调用断言拦住。
      const vectors = change(seedProducts.map((_, idx) => oneHot(idx)))
      mockEmbed.mockResolvedValueOnce([oneHot(0)]).mockResolvedValueOnce(vectors)

      expect(await retrieve('avocado', depsOf(repo))).toEqual([
        { handle: '26016-m', score: expect.any(Number) },
      ])
      expect(mockEmbed).toHaveBeenCalledTimes(2)
      expect(read).toHaveBeenCalledTimes(1)
      expect(upsert).not.toHaveBeenCalled()
      expect(warn.mock.calls).toEqual([
        [JSON.stringify({ event: 'retrieval_fallback', strategy: 'keyword' })],
      ])
    } finally {
      read.mockRestore()
      upsert.mockRestore()
      warn.mockRestore()
    }
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
