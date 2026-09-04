'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

// 最小 provider 空壳（任务 17 填充导购会话状态与浮层 UI）。
// 先落位以便根 layout 一次挂载完毕，避免任务 17 再改 layout。
// 当前无消费者、无行为；消费方必须空值守卫（useAssistant() 返回 null）。
const AssistantContext = createContext<null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  return <AssistantContext.Provider value={null}>{children}</AssistantContext.Provider>
}

export function useAssistant(): null {
  return useContext(AssistantContext)
}
