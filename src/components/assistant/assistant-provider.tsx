'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Mode } from '@/server/ai/events'
import type { ProductView } from '@/server/catalog/service'
import { useChatStream } from './use-chat-stream'
import { AssistantFabSlot } from './fab'
import { AssistantPanel } from './assistant-panel'

/** 导购控制器：PDP 的 "Find my size"（task 12）等消费方调用的契约。 */
export interface AssistantHandle {
  /** 打开面板并设置模式（size-fit 带商品 → 预置上下文并自动询问尺码）。 */
  open: (mode: Mode, product?: ProductView | null) => void
  close: () => void
}

// 根 layout 挂载一次；FAB + Sheet 面板随 Provider 渲染（落地页 FAB 自隐）。
// 会话状态存于 provider（仅客户端，页面刷新即重置——规格 §8"仅当次记忆"）。
const AssistantContext = createContext<AssistantHandle | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { messages, isStreaming, send, retry } = useChatStream()
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('shopping')
  const [product, setProduct] = useState<ProductView | null>(null)

  const close = useCallback(() => setIsOpen(false), [])

  // size-fit 是否已结算：最近一条助手消息为含结构化推荐的已结束消息。
  // 已结算后自由输入再走 size-fit 只会让确定性核心再次追问尺码（死循环），
  // 故 handleSend 自动转向 shopping（用户仍可用上下文 chips 显式重入 size-fit/outfit）。
  const sizeFitSettled = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      return m.sizeFit != null && !m.streaming && !m.error
    }
    return false
  }, [messages])

  const handleChip = useCallback(
    (chipMode: Mode, label: string) => {
      const needsProduct = chipMode === 'size-fit' || chipMode === 'outfit'
      const ref = needsProduct && product ? { handle: product.handle, title: product.title } : null
      setMode(chipMode)
      send(chipMode, label, ref)
    },
    [product, send],
  )

  const open = useCallback(
    (nextMode: Mode, nextProduct?: ProductView | null) => {
      const p = nextProduct ?? null
      setMode(nextMode)
      setProduct(p)
      setIsOpen(true)
      // PDP "Find my size"：商品上下文齐备时直接开场问尺码（消费端自然流），
      // 由服务端 size-fit 确定性核心应答（askedForInput → 追问）。
      if (nextMode === 'size-fit' && p) {
        send('size-fit', '', { handle: p.handle, title: p.title })
      }
    },
    [send],
  )

  const handleSend = useCallback(
    (text: string) => {
      // size-fit 已结算后的自由输入自动转 shopping；同时落定 mode，避免下一条仍粘滞 size-fit。
      const nextMode = mode === 'size-fit' && sizeFitSettled ? 'shopping' : mode
      if (nextMode !== mode) setMode(nextMode)
      const ref = product ? { handle: product.handle, title: product.title } : null
      send(nextMode, text, ref)
    },
    [mode, product, send, sizeFitSettled],
  )

  const value = useMemo<AssistantHandle>(
    () => ({ open, close }),
    [open, close],
  )

  return (
    <AssistantContext.Provider value={value}>
      {children}
      <AssistantFabSlot />
      <AssistantPanel
        isOpen={isOpen}
        onClose={close}
        product={product}
        onRemoveProduct={() => {
          // 移除上下文 chip 后 mode 归位 shopping：否则仍处 size-fit/outfit 的
          // 下一条必然得到服务端 "Pick a product first" invalid 错误。
          setProduct(null)
          setMode('shopping')
        }}
        onSend={handleSend}
        onPick={handleChip}
        onRetry={retry}
        messages={messages}
        isStreaming={isStreaming}
      />
    </AssistantContext.Provider>
  )
}

export function useAssistant(): AssistantHandle | null {
  return useContext(AssistantContext)
}
