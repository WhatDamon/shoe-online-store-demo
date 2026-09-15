import { describe, expect, it } from 'vitest'
import type { ProductCard } from '@/domain/chat-events'
import { applyEvent, type ChatMessage } from './use-chat-stream'

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  content: '',
  streaming: true,
  ...over,
})

const card: ProductCard = {
  handle: 'daily-drift',
  title: 'Daily Drift',
  subtitle: 'DC-1001',
  image: '/products/daily-drift/1.webp',
  imageKind: 'photo',
  photoCount: 2,
  sizeRange: 'US 4.5–9.5',
  colorCount: 3,
  palette: ['#a', '#b'],
}

describe('applyEvent（SSE 帧 → 助手消息，纯函数）', () => {
  it('delta：把增量追加到正文，不动其他字段、不结束流', () => {
    const before = message({ content: 'Hello' })
    const after = applyEvent(before, { type: 'delta', text: ' there' })
    expect(after).toEqual({ ...before, content: 'Hello there' })
    expect(after.streaming).toBe(true)
  })

  it('连续 delta 逐段累加', () => {
    let m = message()
    for (const text of ['a', 'b', 'c']) m = applyEvent(m, { type: 'delta', text })
    expect(m.content).toBe('abc')
  })

  // isValidCard 存在的理由：parseEvent 只验 items 是数组，深层字段形状是运行时的事。
  // 故这里必须真的塞进形状不合法的数据 —— 类型无法表达「坏 ProductCard」，只能整体断言。
  it('productCards：写入卡片，并过滤掉运行时形状不合法的 item', () => {
    const emptyHandle = { ...card, handle: '' } as unknown as ProductCard
    const shortPalette = { ...card, palette: [] } as unknown as ProductCard
    const after = applyEvent(message(), {
      type: 'productCards',
      items: [card, emptyHandle, shortPalette],
    })
    expect(after.cards).toHaveLength(1)
    expect(after.cards?.[0].handle).toBe('daily-drift')
  })

  it('productCards：合法空数组写入空卡片列表（不残留上一帧结果）', () => {
    const after = applyEvent(message({ cards: [card] }), { type: 'productCards', items: [] })
    expect(after.cards).toEqual([])
  })

  it('sizeFit：只带结构化推荐三字段', () => {
    const after = applyEvent(message(), {
      type: 'sizeFit',
      recommended: 43,
      alternatives: [42, 44],
      rationale: 'runs true to size',
    })
    expect(after.sizeFit).toEqual({
      recommended: 43,
      alternatives: [42, 44],
      rationale: 'runs true to size',
    })
  })

  it('done：结束流式，但不清空已收到的正文', () => {
    const after = applyEvent(message({ content: 'partial' }), { type: 'done' })
    expect(after).toEqual({ ...message({ content: 'partial' }), streaming: false })
  })

  it('error：结束流式并挂上温和文案', () => {
    const after = applyEvent(message({ content: 'partial' }), {
      type: 'error',
      code: 'rate_limited',
      message: 'Slow down a moment.',
    })
    expect(after.streaming).toBe(false)
    expect(after.error).toEqual({ code: 'rate_limited', message: 'Slow down a moment.' })
  })

  it('每类帧都返回新对象（React 依赖引用变化触发重渲染）', () => {
    const before = message()
    expect(applyEvent(before, { type: 'done' })).not.toBe(before)
  })
})
