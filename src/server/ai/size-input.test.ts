// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { adviceFor } from './size-input'
import type { ProductView } from '@/server/catalog/service'
import { getProductForMarket } from '@/server/catalog/service'

// size-input 为纯函数（接受 ProductView），用 seed 真实视图 + 空库存变体做 golden。
// dc-1001（Urban Bloom）码段 35-44，含 43。
let view: ProductView

beforeEach(async () => {
  view = (await getProductForMarket('dc-1001'))!
  expect(view).toBeTruthy()
})

describe('adviceFor', () => {
  it('parses "I wear US 9" to recommended EU 43 when in stock', () => {
    const advice = adviceFor(view, 'I wear US 9')
    expect(advice.askedForInput).toBe(false)
    expect(advice.recommended).toBe(43) // dc-1001 sizes 35–44 内含 43
    expect(advice.alternatives).toEqual(view.sizes.filter((s) => s !== 43))
    expect(advice.rationale).toContain(`${view.title} runs`)
    expect(advice.rationale).toContain('43 (EU)')
  })

  it('asks for input when the text carries no size hint', () => {
    const advice = adviceFor(view, 'comfortable')
    expect(advice.askedForInput).toBe(true)
    expect(advice.recommended).toBeNull()
    expect(advice.alternatives).toEqual([])
    expect(advice.rationale).toContain('Can you tell me the size')
  })

  it('reports out of stock when the product has no available sizes nearby', () => {
    const empty = { ...view, sizes: [], sizeOptions: [] }
    const advice = adviceFor(empty, 'I wear US 9')
    expect(advice.askedForInput).toBe(false)
    expect(advice.recommended).toBeNull()
    expect(advice.alternatives).toEqual([])
    expect(advice.rationale).toContain('out of stock')
  })

  describe('known「我的尺码」回退（Find my size 预填）', () => {
    it('text with explicit size wins over known (user answer takes priority)', () => {
      const advice = adviceFor(view, 'I wear US 8.5', null, 43)
      expect(advice.askedForInput).toBe(false)
      expect(advice.recommended).toBe(42) // US 8.5 → EU 42，而非 known 的 43
    })

    it('no size in text falls back to known canonical', () => {
      const advice = adviceFor(view, 'Find my size', null, 43)
      expect(advice.askedForInput).toBe(false)
      expect(advice.recommended).toBe(43)
      expect(advice.rationale).toContain('43 (EU)')
    })

    it('known null + no size in text still asks', () => {
      const advice = adviceFor(view, '', null, null)
      expect(advice.askedForInput).toBe(true)
      expect(advice.recommended).toBeNull()
    })

    it('known size not stocked still asks via nearest? no — out-of-stock wording when none nearby', () => {
      // dc-1001 尺码 35-44；known 46 不在库 → 无货（推荐附近替代，如 44）。
      const advice = adviceFor(view, '', null, 46)
      expect(advice.askedForInput).toBe(false)
      expect(advice.recommended).toBe(44) // 离 46 最近的在库档
    })
  })
})
