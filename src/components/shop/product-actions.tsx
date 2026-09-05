'use client'

import { useState, type ReactNode } from 'react'
import type { CanonicalSize } from '@/server/catalog/types'
import type { ProductView } from '@/server/catalog/service'
import type { ShopifyBuyConfig } from '@/server/catalog/shopify-buy'
import { useAssistant } from '@/components/assistant/assistant-provider'
import { SizeSelector } from './size-selector'
import { ProductBuyBar } from './product-buy-bar'
import { ShopifyBuyButton } from './shopify-buy-button'

interface ProductActionsProps {
  product: ProductView
  /** 服务端已算好的结算 URL（无 store → null） */
  buyUrl: string | null
  /**
   * 商店在售配置（决策 #15 重启用，2026-09-06 全目录）：非 null 时该 PDP 为「商店直购」形态 ——
   * 尺码/颜色选择与 demo 购买条整体隐藏，只渲染 Shopify Buy Button（其 iframe 内自带
   * 商店真实变体选择与店币价格）；Find my size / 手风琴 / 护理海报等 demo 内容保留。
   */
  buyConfig?: ShopifyBuyConfig | null
  /**
   * 由页面（RSC）注入、渲染于 "Find my size" 与购买条之间的内容
   * （材质/合脚手风琴，无尺码依赖）。
   */
  children?: ReactNode
}

// PDP 购买群集（规格 §9 顺序）：颜色选择（多色款，受控）→ 尺码选择 → "Find my size" → 手风琴（children 插槽）→ 购买条。
// children 插槽让本集群保持单一 'use client' 边界共享 selected 状态，同时允许页面以 RSC 注入中间内容；
// 持有所选尺码/颜色状态，供购买条在无 store 阶段做 aria-live 说明。
export function ProductActions({
  product,
  buyUrl,
  buyConfig = null,
  children,
}: ProductActionsProps) {
  const storeLive = buyConfig != null
  const colors = product.colors ?? []
  // 多色款下单前选色：照片未按颜色拆分（决策 #16），色卡仅记录意向，主图保持代表图。
  const [colorIdx, setColorIdx] = useState(0)
  const [selected, setSelected] = useState<CanonicalSize | null>(null)
  // 面板打开 + 预置 size-fit 上下文由 AssistantProvider 处理；context 为空（Provider 未挂载的孤立渲染）时静默。
  const assistant = useAssistant()
  const selectedLabel = product.sizeOptions.find((o) => o.value === selected)?.label ?? null
  const colorName =
    colors.length > 0 ? (colors[Math.min(colorIdx, colors.length - 1)]?.name ?? null) : null

  // Find my size（AI 尺码咨询，商店直购形态下保留 —— 决策：只隐藏选择器与 demo 购买条）
  const findMySize = (
    <div className={storeLive ? '' : '-mt-3'}>
      <button
        type="button"
        onClick={() => assistant?.open('size-fit', product)}
        className="text-sm font-medium text-ink underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
      >
        Find my size
      </button>
    </div>
  )

  // 商店直购形态：隐藏本站颜色/尺码选择器与 demo 购买条，以 Buy Button 全接管变体选择与结算。
  if (storeLive) {
    return (
      <div className="flex flex-col gap-5">
        {findMySize}
        {children}
        <ShopifyBuyButton config={buyConfig} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {colors.length > 1 ? (
        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-sm font-medium text-ink">
            Color
            {colorName ? (
              <span className="ml-1.5 font-normal text-neutral-500">{colorName}</span>
            ) : null}
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {colors.map((c, i) => {
              const active = i === colorIdx
              return (
                <label key={`${c.hex}-${c.name}`} className="group cursor-pointer">
                  <input
                    type="radio"
                    name="colors"
                    value={c.name}
                    checked={active}
                    aria-label={c.name}
                    onChange={() => setColorIdx(i)}
                    className="peer sr-only"
                  />
                  <span
                    className={`block h-9 w-9 rounded-full border transition-shadow group-focus-within:outline group-focus-within:outline-2 group-focus-within:outline-offset-2 group-focus-within:outline-neutral-400 ${
                      active
                        ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas'
                        : 'border-neutral-300'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                </label>
              )
            })}
          </div>
          <p className="text-xs leading-5 text-neutral-500">
            Photos are representative — the actual shade can vary on screen.
          </p>
        </fieldset>
      ) : null}
      <SizeSelector sizeOptions={product.sizeOptions} selected={selected} onChange={setSelected} />
      {findMySize}
      {children}
      <ProductBuyBar
        buyUrl={buyUrl}
        availableSoon={buyUrl == null}
        selectedLabel={selectedLabel}
        colorName={colorName}
      />
    </div>
  )
}
