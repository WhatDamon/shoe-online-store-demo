'use client'

import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircleIcon } from 'lucide-react'
import type { Mode } from '@/server/ai/events'
import type { ProductView } from '@/server/catalog/service'
import { getPageProductSnapshot, type PageProductRef } from '@/lib/page-product'

// 由 AssistantProvider 注入的控制器（结构化契约：避免 provider↔fab 运行时/类型循环导入）。
export interface AssistantFabHandle {
  open: (mode: Mode, product?: ProductView | PageProductRef | null) => void
}

// 右下角导购入口（消费端措辞 "Need a hand?"，克制呈现 P1）。
// 不在落地页出现（P1：Landing 零导购痕迹）；usePathname 消费点用 Suspense 包裹，
// 保证静态页预渲染不受影响（fallback null，水合后才按路径决定显隐）。
function AssistantFab({ assistant }: { assistant: AssistantFabHandle | null }) {
  const pathname = usePathname()
  if (!assistant || pathname === '/') return null
  // PDP 锚定（page-product store）：在商品详情页上打开即带上当前鞋（轻引用 handle+title，
  // 服务端按 handle 回取全量事实注入）。关键：必须在 onClick 回调内读锚点，而非渲染时——
  // 锚点在水合后才由 PDP 注册，渲染期读取会让闭包永远持有 null（生产页不重渲染）。
  return (
    <button
      type="button"
      onClick={() => assistant.open('shopping', getPageProductSnapshot())}
      aria-label="Open shopping assistant"
      className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-canvas shadow-lg transition-transform hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
    >
      <MessageCircleIcon className="size-5" aria-hidden="true" />
      <span className="hidden sm:inline">Need a hand?</span>
    </button>
  )
}

// 挂载点：随 Provider 渲染；仅非落地页渲染按钮（由内部 usePathname 判定）。
export function AssistantFabSlot({ assistant }: { assistant: AssistantFabHandle | null }) {
  return (
    <Suspense fallback={null}>
      <AssistantFab assistant={assistant} />
    </Suspense>
  )
}
