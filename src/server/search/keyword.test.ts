import { describe, expect, it } from 'vitest'
import { keywordSearch } from './keyword'
import { seedProducts } from '@/server/catalog/seed'
import type { Product } from '@/server/catalog/types'

// 以 p01 为基底克隆出受控 fixture，彻底覆盖会用到的字段，
// 保证除显式设置的词外没有额外 token 干扰打分。
function makeProduct(handle: string, over: Partial<Product>): Product {
  const base = seedProducts[0]
  return {
    ...base,
    id: `x-${handle}`,
    handle,
    title: '',
    subtitle: '',
    productType: 'Sneaker',
    tags: [],
    features: [],
    description: '',
    ...over,
  }
}

describe('keywordSearch', () => {
  it('命中 lightweight 标签的鞋排在没有该标签的鞋之前（无命中者不返回）', () => {
    const tagged = seedProducts[0] // p01 daily-drift, tags 含 'lightweight'
    const plain = seedProducts[1] // p02 cloudwalk-slip, tags 无 'lightweight'
    const res = keywordSearch('lightweight', [plain, tagged])
    expect(res).toHaveLength(1)
    expect(res[0].handle).toBe(tagged.handle)
    expect(res[0].score).toBeGreaterThan(0)
  })

  it('零命中返回空数组', () => {
    expect(keywordSearch('zzzqwertyplokmnb', seedProducts)).toEqual([])
    expect(keywordSearch('', seedProducts)).toEqual([])
  })

  it('多 token 加权：title 命中权重高于正文命中', () => {
    const titleShoe = makeProduct('cloud-runner', {
      title: 'Cloud Runner',
      features: ['lightweight'],
    }) // cloud(标题)×3 + lightweight(正文) = 高
    const bodyShoe = makeProduct('trail-boot', {
      title: 'Trail Boot',
      features: ['lightweight'],
      description: 'a cloud of soft foam',
    }) // cloud(正文) + lightweight(正文) = 低
    const res = keywordSearch('cloud lightweight', [bodyShoe, titleShoe])
    expect(res).toHaveLength(2)
    expect(res[0].handle).toBe('cloud-runner')
    expect(res[1].handle).toBe('trail-boot')
    expect(res[0].score).toBeGreaterThan(res[1].score)
  })

  it('降序返回且仅含命中产品', () => {
    const res = keywordSearch('cloudwalk', seedProducts)
    expect(res.length).toBeGreaterThan(0)
    for (let i = 1; i < res.length; i++) {
      expect(res[i - 1].score).toBeGreaterThanOrEqual(res[i].score)
    }
    for (const r of res) {
      const p = seedProducts.find((s) => s.handle === r.handle)
      expect(p).toBeDefined()
    }
  })
})
