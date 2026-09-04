'use client'

import { useState } from 'react'
import type { CanonicalSize } from '@/server/catalog/types'
import type { ProductView } from '@/server/catalog/service'
import { useAssistant } from '@/components/assistant/assistant-provider'
import { SizeSelector } from './size-selector'
import { ProductBuyBar } from './product-buy-bar'

// 任务 17 填充 AssistantProvider 后提供 open(mode, product?)；此处先引用契约：
// 当前 context 为 null → 空守卫（占位入口，无对话逻辑），到任务 17 无需再改本文件。
type AssistantHandle = { open: (mode: 'size-fit', product: ProductView) => void }

interface ProductActionsProps {
  product: ProductView
  /** 服务端已算好的结算 URL（无 store → null） */
  buyUrl: string | null
}

// PDP 购买群集：尺码选择（受控）+ "Find my size" 助手入口 + 购买条。
// 持有所选尺码状态，供购买条在无 store 阶段做 aria-live 说明。
export function ProductActions({ product, buyUrl }: ProductActionsProps) {
  const [selected, setSelected] = useState<CanonicalSize | null>(null)
  const assistant = useAssistant() as AssistantHandle | null
  const selectedLabel = product.sizeOptions.find(o => o.value === selected)?.label ?? null

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
      <ProductBuyBar buyUrl={buyUrl} availableSoon={buyUrl == null} selectedLabel={selectedLabel} />
    </div>
  )
}
