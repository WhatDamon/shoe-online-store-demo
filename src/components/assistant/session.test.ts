import { describe, expect, it } from 'vitest'
import type { Mode } from '@/domain/chat-events'
import type { ChatMessage } from './use-chat-stream'
import {
  INITIAL_SESSION,
  modeForSend,
  needsProduct,
  productRefOf,
  sessionReducer,
  sizeFitSettled,
  type SessionState,
} from './session'

const PRODUCT = { handle: 'daily-drift', title: 'Daily Drift' }

/** 最小助手消息（只带规则关心的字段）。 */
const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  content: '',
  ...over,
})
const user = (): ChatMessage => ({ id: 'u1', role: 'user', content: 'hi' })

const SETTLED: ChatMessage = assistant({
  streaming: false,
  sizeFit: { recommended: 43, alternatives: [42], rationale: 'r' },
})

describe('sessionReducer', () => {
  it('open：同时设置模式与商品锚定（替换而非合并）', () => {
    const next = sessionReducer(
      { mode: 'shopping', product: { handle: 'old', title: 'Old' } },
      { type: 'open', mode: 'size-fit', product: PRODUCT },
    )
    expect(next).toEqual({ mode: 'size-fit', product: PRODUCT })
  })

  it('open：new ProductView 也可作为锚定，product 可为 null', () => {
    expect(
      sessionReducer(INITIAL_SESSION, { type: 'open', mode: 'shopping', product: null }).product,
    ).toBeNull()
  })

  it('pick：chip 重入改变模式但保留商品锚定', () => {
    const state: SessionState = { mode: 'shopping', product: PRODUCT }
    expect(sessionReducer(state, { type: 'pick', mode: 'outfit' })).toEqual({
      mode: 'outfit',
      product: PRODUCT,
    })
    expect(sessionReducer(state, { type: 'pick', mode: 'size-fit' })).toEqual({
      mode: 'size-fit',
      product: PRODUCT,
    })
  })

  it('clear-product：移除商品上下文后模式归位 shopping', () => {
    expect(
      sessionReducer({ mode: 'size-fit', product: PRODUCT }, { type: 'clear-product' }),
    ).toEqual({ mode: 'shopping', product: null })
  })

  it('sent：落定新模式', () => {
    expect(
      sessionReducer({ mode: 'size-fit', product: PRODUCT }, { type: 'sent', mode: 'shopping' }),
    ).toEqual({ mode: 'shopping', product: PRODUCT })
  })

  it('sent：模式未变时返回同一个 state 对象（避免无谓重渲染）', () => {
    const state: SessionState = { mode: 'shopping', product: null }
    expect(sessionReducer(state, { type: 'sent', mode: 'shopping' })).toBe(state)
  })
})

describe('needsProduct', () => {
  it('只有 size-fit / outfit 需要商品锚定', () => {
    const modes: Mode[] = ['shopping', 'find-shoes', 'outfit', 'size-fit', 'support']
    expect(modes.filter(needsProduct)).toEqual(['outfit', 'size-fit'])
  })
})

describe('productRefOf', () => {
  it('收敛成服务端要的 {handle,title}，完整 ProductView 的多余字段不带进去', () => {
    const view = { ...PRODUCT, sizes: [43], sizeOptions: [] } as unknown as SessionState['product']
    expect(productRefOf(view)).toEqual(PRODUCT)
  })

  it('无商品时为 null', () => {
    expect(productRefOf(null)).toBeNull()
  })
})

describe('sizeFitSettled（规则一：size-fit 已结算后自由输入转 shopping）', () => {
  it('最近一条助手消息带结构化推荐且已结束 → 已结算', () => {
    expect(sizeFitSettled([user(), SETTLED])).toBe(true)
  })

  it('推荐仍在流式 → 未结算', () => {
    expect(sizeFitSettled([assistant({ streaming: true, sizeFit: SETTLED.sizeFit })])).toBe(false)
  })

  it('推荐那轮出错 → 未结算', () => {
    expect(
      sizeFitSettled([
        assistant({ error: { code: 'provider', message: 'x' }, sizeFit: SETTLED.sizeFit }),
      ]),
    ).toBe(false)
  })

  it('最近一条助手消息只是追问（无 sizeFit 事件）→ 未结算', () => {
    expect(sizeFitSettled([assistant({ content: 'What size do you wear?' })])).toBe(false)
  })

  it('只看最近一条助手消息：更早的推荐已结算也被后来的追问覆盖', () => {
    expect(sizeFitSettled([SETTLED, assistant({ content: 'sure!' })])).toBe(false)
  })

  it('空会话 → 未结算', () => {
    expect(sizeFitSettled([])).toBe(false)
  })

  it('modeForSend：已结算的 size-fit 自由输入转 shopping，其余模式不受影响', () => {
    expect(modeForSend({ mode: 'size-fit', product: PRODUCT }, true)).toBe('shopping')
    expect(modeForSend({ mode: 'size-fit', product: PRODUCT }, false)).toBe('size-fit')
    expect(modeForSend({ mode: 'outfit', product: PRODUCT }, true)).toBe('outfit')
    expect(modeForSend({ mode: 'support', product: null }, true)).toBe('support')
  })
})
