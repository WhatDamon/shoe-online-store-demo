import { describe, expect, it } from 'vitest'
import { GIFT_OFFER_FACT, GIFT_OFFER_RULES, systemFor } from './prompts'
import { POLICY_CARE, POLICY_RETURNS } from '@/lib/store-policy'

// 赠品营销只存在于 shopping 模式（决策 #16 + P1 克制：不打扰找鞋/搭配/尺码流程）。
const OFFER_MARKERS = ['over $50', 'little buddy', 'offcut'] as const

describe('gift offer prompt copy', () => {
  it('surfaces the $50 free-gift offer only in shopping mode', () => {
    const shopping = systemFor('shopping', { catalogDigest: '- Urban Bloom ($108.00)' })
    for (const m of OFFER_MARKERS) expect(shopping).toContain(m)
    // 确认版权规则真的注入到该模式（检查特征短语，而非变量名）。
    expect(shopping).toContain('original little buddies')
    for (const mode of ['find-shoes', 'outfit', 'size-fit'] as const) {
      const sys = systemFor(mode, {})
      for (const m of OFFER_MARKERS) expect(sys).not.toContain(m)
    }
  })

  it('offer copy is copyright-safe: no third-party character or brand names', () => {
    const copy = `${GIFT_OFFER_FACT}\n${GIFT_OFFER_RULES}`.toLowerCase()
    // 禁止点名/暗示卡通/玩具/影视/动漫角色与第三方品牌（含供应链原名里的知名形象）。
    const forbidden = [
      'pokémon',
      'pikachu',
      'squirtle',
      'psyduck',
      'totoro',
      'mickey',
      'disney',
      'sanrio',
      'hello kitty',
      'ultraman',
      '奥特曼',
      '皮卡丘',
      '杰尼龟',
      '可达鸭',
      '比卡丘',
      'partnership with',
      'collaboration with',
    ]
    for (const term of forbidden) expect(copy).not.toContain(term)
    // 版权规则必须要求模型不联想、不暗示联名/授权，且允许用户在追问时给出中性回绝。
    expect(GIFT_OFFER_RULES).toMatch(/never (name|imply|compare|suggest)/i)
    expect(GIFT_OFFER_RULES).toMatch(/original little buddies/i)
  })
})

describe('support 店务客服 prompt', () => {
  it('注入店务事实（发货/退换/护理）且不注入任何商品目录/营销推送', () => {
    const sys = systemFor('support', {})
    // 事实来自单源 store-policy（与 PDP 静态文案同一份）。
    expect(sys).toContain(POLICY_RETURNS)
    expect(sys).toContain(POLICY_CARE)
    expect(sys).toContain('printed to order')
    // 克制 P1：客服口径不出现促销/gift/赠品营销句，也不出现商品检索词。
    for (const m of OFFER_MARKERS) expect(sys).not.toContain(m)
    expect(sys).not.toMatch(/Catalog:/)
    expect(sys).not.toMatch(/Product:/)
    // 限定只基于注入事实作答，不编造物流/订单能力。
    expect(sys).toMatch(/only the facts below/i)
    expect(sys).toMatch(/never invent shipping times/i)
  })
})
