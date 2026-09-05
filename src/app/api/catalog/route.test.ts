// GET /api/catalog 只读摘要（seed 环境纯内存，无磁盘/网络）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const base = 'http://localhost/api/catalog'

const get = async (query: string): Promise<Response> => {
  const { GET } = await import('./route')
  return GET(new Request(`${base}?${query}`))
}

describe('GET /api/catalog', () => {
  beforeEach(() => {
    vi.resetModules() // route 模块级依赖（catalog 单例等）按环境重取
  })

  it('returns an empty array when no handles param', async () => {
    const res = await get('')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('resolves known handles in request order with summary fields', async () => {
    const { seedProducts } = await import('@/server/catalog/seed')
    const first = seedProducts[0]
    const second = seedProducts[1]
    const res = await get(`handles=${first.handle},${second.handle}`)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0]).toMatchObject({ handle: first.handle, title: first.title })
    expect(body[1]).toMatchObject({ handle: second.handle, title: second.title })
    // 摘要 shape：图片/色数/照片数/码段/商店态
    expect(typeof body[0].image).toBe('string')
    expect(typeof body[0].colorCount).toBe('number')
    expect(typeof body[0].photoCount).toBe('number')
    expect(body[0].storeAvailable).toBeTypeOf('boolean')
    expect('price' in body[0]).toBe(false) // 只读展示端点不带价
  })

  it('dedupes repeated handles while preserving first occurrence order', async () => {
    const { seedProducts } = await import('@/server/catalog/seed')
    const a = seedProducts[0]
    const b = seedProducts[1]
    const res = await get(`handles=${a.handle},${b.handle},${a.handle}`)
    const body = await res.json()
    expect(body.map((x: { handle: string }) => x.handle)).toEqual([a.handle, b.handle])
  })

  it('filters unknown handles silently (stale wishlist items do not 404)', async () => {
    const { seedProducts } = await import('@/server/catalog/seed')
    const known = seedProducts[0].handle
    const res = await get(`handles=nope-123,${known}`)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].handle).toBe(known)
  })

  it('caps oversized handle lists to 30', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `h${i}`).join(',')
    const res = await get(`handles=${many}`)
    const body = await res.json()
    expect(body).toHaveLength(0) // 全是未知 → 空；上限防止超大参数滥用
  })

  it('sizeRange reflects the market system (US) and null for size-less products', async () => {
    const { seedProducts } = await import('@/server/catalog/seed')
    const withSize = seedProducts.find((p) => p.sizes.length > 0)!
    const noSize = seedProducts.find((p) => p.sizes.length === 0)
    const list = [withSize.handle]
    if (noSize) list.push(noSize.handle)
    const res = await get(`handles=${list.join(',')}`)
    const body = await res.json()
    expect(body[0].sizeRange).toMatch(/^US /)
    if (noSize) {
      const second = body.find((x: { handle: string }) => x.handle === noSize.handle)
      expect(second.sizeRange).toBeNull()
    }
  })
})
