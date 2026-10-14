import { describe, expect, it } from 'vitest'
import en from './en'

describe('en 词典命名空间', () => {
  // 抽取任务按批次交付键族：批次 A 交付 nav / marketing / faq；批次 C（助手界面与服务端
  // AI/护栏的消费端文案）交付 assistant / guardrail。全量命名空间断言在最后一个抽取任务里做
  // ——放在这里会让它依赖尚未完成的任务（裁决 R7）。
  it.each(['nav', 'marketing', 'faq'])('存在 %s 命名空间', (ns) => {
    expect(Object.keys(en).some((key) => key.startsWith(`${ns}.`))).toBe(true)
  })

  it.each(['assistant', 'guardrail'])('存在 %s 命名空间（批次 C）', (ns) => {
    expect(Object.keys(en).some((key) => key.startsWith(`${ns}.`))).toBe(true)
  })
})

// 批次 D 是最后一个抽取任务（landing / blog / 错误边界与系统页），故全量断言放这里。
// 清单以**词典实际拥有的命名空间**为准：计划里写的 13 个漏了 `faq`（批次 A）与 `og`（批次 A 既有）
// 两个早已交付的族，而 `notFound` 已在表内；这里是实测的 16 个（`lang` 随语言切换器加入）。
const NAMESPACES = [
  'nav',
  'lang',
  'marketing',
  'faq',
  'og',
  'notFound',
  'shop',
  'pdp',
  'cart',
  'checkout',
  'orders',
  'errors',
  'assistant',
  'guardrail',
  'blog',
  'error',
] as const

describe('全量命名空间已交付', () => {
  it.each(NAMESPACES)('存在 %s 命名空间', (ns) => {
    expect(Object.keys(en).some((key) => key.startsWith(`${ns}.`))).toBe(true)
  })

  // 逐名断言只能证明「这些族在」；这一条把「不在清单里的族」也钉住：新增键族必须登记进
  // `NAMESPACES`（阶段 2 加语言时它能立刻提醒「新族还没有译文计划」）。
  it('顶层命名空间集合正好是清单里的这些', () => {
    const declared = [...NAMESPACES].sort()
    const present = [...new Set(Object.keys(en).map((key) => key.split('.')[0]))].sort()
    expect(present).toEqual(declared)
  })
})
