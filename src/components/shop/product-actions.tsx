'use client'

import { useState, type ReactNode } from 'react'
import type { CanonicalSize } from '@/server/catalog/types'
import type { ProductView } from '@/server/catalog/service'
import { useAssistant } from '@/components/assistant/assistant-provider'
import { SizeSelector } from './size-selector'
import { ProductBuyBar } from './product-buy-bar'

interface ProductActionsProps {
  product: ProductView
  /** 服务端已算好的结算 URL（无 store → null） */
  buyUrl: string | null
  /**
   * 由页面（RSC）注入、渲染于 "Find my size" 与购买条之间的内容
   * （材质/合脚手风琴，无尺码依赖）。
   */
  children?: ReactNode
  /** 可选购买替代槽（如 Shopify Buy Button）：存在时替换 ProductBuyBar，保持 §9 CTA 位序。 */
  buySlot?: ReactNode
}

// PDP 购买群集（规格 §9 顺序）：尺码选择（受控）→ "Find my size" → 手风琴（children 插槽）→ 购买条。
// children 插槽让本集群保持单一 'use client' 边界共享 selected 状态，同时允许页面以 RSC 注入中间内容；
// 持有所选尺码状态，供购买条在无 store 阶段做 aria-live 说明。
export function ProductActions({ product, buyUrl, children, buySlot }: ProductActionsProps) {
  const [selected, setSelected] = useState<CanonicalSize | null>(null)
  // 面板打开 + 预置 size-fit 上下文由 AssistantProvider 处理；context 为空（Provider 未挂载的孤立渲染）时静默。
  const assistant = useAssistant()
  const selectedLabel = product.sizeOptions.find((o) => o.value === selected)?.label ?? null

  return (
    <div className="flex flex-col gap-5">
      <SizeSelector sizeOptions={product.sizeOptions} selected={selected} onChange={setSelected} />
      <div className="-mt-3">
        <button
          type="button"
          onClick={() => assistant?.open('size-fit', product)}
          className="text-sm font-medium text-ink underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
        >
          Find my size
        </button>
      </div>
      {children}
      {buySlot ?? (
        <ProductBuyBar buyUrl={buyUrl} availableSoon={buyUrl == null} selectedLabel={selectedLabel} />
      )}
    </div>
  )
}
