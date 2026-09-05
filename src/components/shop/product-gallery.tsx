'use client'

import Image from 'next/image'
import { useState } from 'react'
import type { ProductView } from '@/server/catalog/service'
import { ProductVisual, type ProductVisualView } from './product-visual'

const VIEW_LABELS: { view: ProductVisualView; label: string }[] = [
  { view: 'side', label: 'Side' },
  { view: 'sole', label: 'Sole' },
  { view: 'detail', label: 'Detail' },
]

// PDP 画廊（决策 #16）：有真实照片（public/products/…）时用照片相册（首图为主图，缩略切换）；
// 无图产品回落到本地程序化 SVG 三视图（side/sole/detail）。
// 缩略图按钮 aria-hidden 内联图，可访问名由按钮自身的 label 承担，避免重复播报。
export function ProductGallery({ product }: { product: ProductView }) {
  const photos = product.images ?? []
  const hasPhotos = photos.length > 0
  const [photoIdx, setPhotoIdx] = useState(0)
  const [active, setActive] = useState<ProductVisualView>('side')
  const activePhoto = hasPhotos ? photos[Math.min(photoIdx, photos.length - 1)] : null

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {hasPhotos && activePhoto ? (
          <Image
            key={activePhoto}
            src={activePhoto}
            alt={`${product.title} photo ${photoIdx + 1}`}
            fill
            priority={photoIdx === 0}
            sizes="(min-width:1024px) 50vw, 100vw"
            className="object-contain"
          />
        ) : (
          <ProductVisual
            visual={product.visual}
            name={product.title}
            construction={product.construction}
            view={active}
            idSalt="gallery-main"
            className="mx-auto h-full w-full max-w-xl"
          />
        )}
      </div>
      <div className="flex gap-2" role="group" aria-label={`${product.title} views`}>
        {hasPhotos
          ? photos.map((src, i) => {
              const current = photoIdx === i
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => setPhotoIdx(i)}
                  aria-pressed={current}
                  aria-label={`Show photo ${i + 1}`}
                  className={`rounded-xl border p-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 ${
                    current
                      ? 'border-neutral-400 ring-1 ring-neutral-300'
                      : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none relative block h-14 w-14 overflow-hidden rounded-lg bg-white sm:h-16 sm:w-16"
                  >
                    <Image src={src} alt="" fill sizes="64px" className="object-contain" />
                  </span>
                </button>
              )
            })
          : VIEW_LABELS.map(({ view, label }) => {
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
                  <span
                    aria-hidden="true"
                    className="pointer-events-none block h-14 w-14 sm:h-16 sm:w-16"
                  >
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
