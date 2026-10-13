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
