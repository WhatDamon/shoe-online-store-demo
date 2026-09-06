// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest'
import { createDb, pgConnectOptions } from './client'
import { createRepository } from '@/server/search/repository'
import { cosine } from '@/server/search/vector'

describe('db', () => {
  const db = createDb(':memory:')
  const repo = createRepository(db)
  beforeEach(async () => {
    await repo.wipe() // 测试辅助：TRUNCATE 两张表
  })
  it('upserts and reads embeddings', async () => {
    await repo.upsertEmbedding({
      productId: 'p1',
      contentHash: 'h1',
      model: 'm1',
      vector: [1, 0, 0],
    })
    const row = await repo.getEmbedding('p1')
    expect(row?.vector).toEqual([1, 0, 0])
  })
  it('content hash change invalidates via overwrite', async () => {
    await repo.upsertEmbedding({
      productId: 'p1',
      contentHash: 'h1',
      model: 'm1',
      vector: [1, 0, 0],
    })
    await repo.upsertEmbedding({
      productId: 'p1',
      contentHash: 'h2',
      model: 'm1',
      vector: [0, 1, 0],
    })
    const row = await repo.getEmbedding('p1')
    expect(row?.contentHash).toBe('h2')
  })
  it('logs usage and sums by day', async () => {
    await repo.insertUsage({
      day: '2026-09-04',
      model: 'mock',
      promptTokens: 10,
      completionTokens: 5,
      sessionKey: 's1',
    })
    await repo.insertUsage({
      day: '2026-09-04',
      model: 'mock',
      promptTokens: 20,
      completionTokens: 5,
      sessionKey: 's2',
    })
    expect(await repo.dayTokenUsage('2026-09-04')).toBe(40)
    expect(await repo.dayTokenUsage('2026-09-05')).toBe(0)
  })
})

describe('pgConnectOptions', () => {
  it('off by default / when unset or zero (Vercel empty-string injection)', () => {
    expect(pgConnectOptions({})).toBeNull()
    expect(pgConnectOptions({ PG_SSL: '' })).toBeNull()
    expect(pgConnectOptions({ PG_SSL: '0' })).toBeNull()
    expect(pgConnectOptions({ PG_SSL: '   ' })).toBeNull()
  })
  it('enables TLS-without-verification for Cloud SQL public IP when PG_SSL set', () => {
    expect(pgConnectOptions({ PG_SSL: '1' })).toEqual({ rejectUnauthorized: false })
    expect(pgConnectOptions({ PG_SSL: 'require' })).toEqual({ rejectUnauthorized: false })
  })
})

describe('cosine', () => {
  it('returns 1 for identical unit vectors', () => expect(cosine([1, 0], [1, 0])).toBeCloseTo(1))
  it('returns 0 for orthogonal', () => expect(cosine([1, 0], [0, 1])).toBeCloseTo(0))
  it('is scale-invariant', () => expect(cosine([2, 0], [1, 0])).toBeCloseTo(1))
})
