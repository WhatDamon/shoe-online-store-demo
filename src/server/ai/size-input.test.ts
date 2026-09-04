// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { adviceFor } from './size-input'
import type { ProductView } from '@/server/catalog/service'
import { getProductForMarket } from '@/server/catalog/service'

// size-input 为纯函数（接受 ProductView），用 seed 真实视图 + 一个空库存变体做 golden。
const dailyDrift = (): Promise<ProductView | null> => getProductForMarket('daily-drift')

describe('adviceFor', () => {
  it('parses "I wear US 9" to recommended EU 43 when in stock', async () => {
    const view = await dailyDrift()
    expect(view).not.toBeNull()
    const advice = adviceFor(view!, 'I wear US 9')
    expect(advice.askedForInput).toBe(false)
    expect(advice.recommended).toBe(43) // daily-drift sizes 40–45 内含 43
    expect(advice.alternatives).toEqual([40, 41, 42, 44, 45])
    expect(advice.rationale).toContain('Daily Drift runs')
    expect(advice.rationale).toContain('43 (EU)')
  })

  it('asks for input when the text carries no size hint', async () => {
    const view = await dailyDrift()
    const advice = adviceFor(view!, 'comfortable')
    expect(advice.askedForInput).toBe(true)
    expect(advice.recommended).toBeNull()
    expect(advice.alternatives).toEqual([])
    expect(advice.rationale).toContain('Can you tell me the size')
  })

  it('reports out of stock when the product has no available sizes nearby', async () => {
    const view = await dailyDrift()
    const empty = { ...view!, sizes: [], sizeOptions: [] }
    const advice = adviceFor(empty, 'I wear US 9')
    expect(advice.askedForInput).toBe(false)
    expect(advice.recommended).toBeNull()
    expect(advice.alternatives).toEqual([])
    expect(advice.rationale).toContain('out of stock')
  })
})
