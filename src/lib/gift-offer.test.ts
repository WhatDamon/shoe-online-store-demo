import { describe, expect, it } from 'vitest'
import { GIFT_ITEM_DESCRIPTION, GIFT_OFFER, GIFT_OFFER_FACT } from './gift-offer'

// 这批断言是重构的等价证明：把单源化之前的字面量逐字节钉住。
// 拆成事实片段再拼回来，必须与实际渲染出来的句子完全一致 —— 否则 AI prompt 与
// 页面文案会在无人察觉的情况下改变。文案要改就改这里的期望值，改一处即视为口径变更。
describe('赠品活动事实单源', () => {
  it('AI prompt 事实句与单源化前逐字节一致', () => {
    expect(GIFT_OFFER_FACT).toBe(
      'Store offer: any order over $50 at the storefront includes one free little buddy — a small accessory pressed from leftover upper offcuts — while supplies last.',
    )
  })

  it('gift 条目描述与单源化前逐字节一致', () => {
    expect(GIFT_ITEM_DESCRIPTION).toBe(
      'A little buddy pressed from leftover upper offcuts. Free with any order over $50 — while supplies last.',
    )
  })

  it('门槛/赠品名/材质只定义一次，各呈现面读到的是同一份事实', () => {
    expect(GIFT_OFFER.thresholdUsd).toBe(50)
    for (const copy of [GIFT_OFFER_FACT, GIFT_ITEM_DESCRIPTION]) {
      expect(copy).toContain(`$${GIFT_OFFER.thresholdUsd}`)
      expect(copy).toContain(GIFT_OFFER.name)
      expect(copy).toContain(GIFT_OFFER.material)
    }
  })
})
