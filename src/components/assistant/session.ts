'use client'

// 助手会话的领域规则：模式、商品锚定，以及「size-fit 已结算后自由输入应转向 shopping」。
// 抽成 reducer + 纯函数后这些规则可单测 —— 此前只能靠 ~500 行 UI 测试（mock fetch、驱动真实
// 组件、等流式渲染）间接覆盖，规则一改就要跑整套 UI 才能发现问题。
import type { Mode } from '@/domain/chat-events'
import type { ProductView } from '@/domain/product'
import type { PageProductRef } from '@/lib/page-product'
import type { ChatMessage } from './use-chat-stream'

/** 商品锚定：完整 ProductView（页面内入口）或轻引用 {handle,title}（FAB 页面锚点）。 */
export type SessionProduct = ProductView | PageProductRef | null

export interface SessionState {
  mode: Mode
  product: SessionProduct
}

export const INITIAL_SESSION: SessionState = { mode: 'shopping', product: null }

export type SessionAction =
  /** 打开面板并设置模式（PDP "Find my size" / FAB 锚定） */
  | { type: 'open'; mode: Mode; product: SessionProduct }
  /** 上下文 chip 重入某模式（保留当前商品锚定） */
  | { type: 'pick'; mode: Mode }
  /** 移除商品上下文 → 模式归位 */
  | { type: 'clear-product' }
  /** 发送后落定模式，避免下一条仍粘滞旧模式 */
  | { type: 'sent'; mode: Mode }

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'open':
      return { mode: action.mode, product: action.product }
    case 'pick':
      return { ...state, mode: action.mode }
    // 移除商品后 mode 归位 shopping：否则仍处 size-fit/outfit 的下一条必然得到服务端
    // "Pick a product first" invalid 错误。
    case 'clear-product':
      return { mode: 'shopping', product: null }
    case 'sent':
      return state.mode === action.mode ? state : { ...state, mode: action.mode }
  }
}

/** 需要商品锚定的模式（缺商品时服务端回 "Pick a product first"）。 */
export const needsProduct = (mode: Mode): boolean => mode === 'size-fit' || mode === 'outfit'

/** 发给服务端的最小商品引用（服务端按 handle 回取全量事实）。 */
export const productRefOf = (product: SessionProduct): { handle: string; title: string } | null =>
  product ? { handle: product.handle, title: product.title } : null

/** size-fit 是否已结算：最近一条助手消息为「带结构化推荐、已结束、无错误」的回复。
 * 已结算后自由输入再走 size-fit 只会让确定性核心再次追问尺码（死循环）。 */
export function sizeFitSettled(messages: readonly ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    return m.sizeFit != null && !m.streaming && !m.error
  }
  return false
}

/** 自由输入该用哪个模式：size-fit 已结算 → shopping（用户仍可用上下文 chip 显式重入）。 */
export const modeForSend = (state: SessionState, settled: boolean): Mode =>
  state.mode === 'size-fit' && settled ? 'shopping' : state.mode
