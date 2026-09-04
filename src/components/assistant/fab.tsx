'use client'

import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircleIcon } from 'lucide-react'
import { useAssistant } from './assistant-provider'

// 右下角导购入口（消费端措辞 "Need a hand?"，克制呈现 P1）。
// 不在落地页出现（P1：Landing 零导购痕迹）；usePathname 消费点用 Suspense 包裹，
// 保证静态页预渲染不受影响（fallback null，水合后才按路径决定显隐）。
export function AssistantFab() {
  const assistant = useAssistant()
  const pathname = usePathname()
  if (!assistant || pathname === '/') return null
  return (
    <button
      type="button"
      onClick={() => assistant.open('shopping', null)}
      aria-label="Open shopping assistant"
      className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-canvas shadow-lg transition-transform hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
    >
      <MessageCircleIcon className="size-5" aria-hidden="true" />
      <span className="hidden sm:inline">Need a hand?</span>
    </button>
  )
}

// 挂载点：随根 layout 一起；仅非落地页渲染按钮（由内部 usePathname 判定）。
export function AssistantFabSlot() {
  return (
    <Suspense fallback={null}>
      <AssistantFab />
    </Suspense>
  )
}
