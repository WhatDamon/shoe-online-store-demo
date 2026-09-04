'use client'

import { useState } from 'react'
import type { ProductView } from '@/server/catalog/service'
import { ProductVisual, type ProductVisualView } from './product-visual'

const VIEW_LABELS: { view: ProductVisualView; label: string }[] = [
  { view: 'side', label: 'Side' },
  { view: 'sole', label: 'Sole' },
  { view: 'detail', label: 'Detail' },
]

// PDP 画廊：本地程序化 SVG 三视图（side/sole/detail）+ 缩略切换（客户端小组件）。
// 缩略 svg 用 aria-hidden 包裹：其可访问名由按钮自己的 label 承担，避免重复播报。
export function ProductGallery({ product }: { product: ProductView }) {
  const [active, setActive] = useState<ProductVisualView>('side')

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-[#f3f1ea]">
        <ProductVisual
          visual={product.visual}
          name={product.title}
          construction={product.construction}
          view={active}
          idSalt="gallery-main"
          className="mx-auto aspect-square w-full max-w-xl"
        />
      </div>
      <div className="flex gap-2" role="group" aria-label={`${product.title} views`}>
        {VIEW_LABELS.map(({ view, label }) => {
          const current = active === view
          return (
            <button
              key={view}
              type="button"
              onClick={() => setActive(view)}
              aria-pressed={current}
              aria-label={`Show ${label.toLowerCase()} view`}
              className={`rounded-xl border p-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 ${
                current
                  ? 'border-neutral-400 ring-1 ring-neutral-300'
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <span aria-hidden="true" className="pointer-events-none block h-14 w-14 sm:h-16 sm:w-16">
                <ProductVisual
                  visual={product.visual}
                  name={product.title}
                  construction={product.construction}
                  view={view}
                  idSalt={`gallery-thumb-${view}`}
                  className="h-full w-full"
                />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
