'use client'

import Image from 'next/image'
import { useState } from 'react'
import type { ProductView } from '@/domain/product'
import { useMessages } from '@/components/i18n/locale-provider'
import type { Messages } from '@/i18n/messages'
import { ProductVisual, type ProductVisualView } from './product-visual'
import { useOptionalProductColorSelection } from './product-color-selection'

// 缩略图的**可及名整句**进词典（`Show side view`），不把 `Side` 小写化后再拼：对已译文本做
// `toLowerCase()` 在部分语言里会变形（与 `promise-strip.tsx` 的键表同款写法）。
const VIEW_LABELS = [
  { view: 'side', labelKey: 'pdp.gallery.viewSide' },
  { view: 'sole', labelKey: 'pdp.gallery.viewSole' },
  { view: 'detail', labelKey: 'pdp.gallery.viewDetail' },
] as const satisfies readonly { view: ProductVisualView; labelKey: keyof Messages }[]

// PDP 画廊：有真实照片（public/products/…）时用照片相册（首图为主图，缩略切换）；
// 无图产品回落到本地程序化 SVG 三视图（side/sole/detail）。
// 缩略图按钮 aria-hidden 内联图，可访问名由按钮自身的 label 承担，避免重复播报。
export function ProductGallery({ product }: { product: ProductView }) {
  const t = useMessages()
  const photos = product.images ?? []
  const hasPhotos = photos.length > 0
  const [photoIdx, setPhotoIdx] = useState(0)
  const [active, setActive] = useState<ProductVisualView>('side')
  const colorSelection = useOptionalProductColorSelection()
  const linkedToColors = colorSelection?.imagesFollowColors === true
  const activePhotoIdx = linkedToColors ? colorSelection.colorIndex : photoIdx
  const activePhoto = hasPhotos ? photos[Math.min(activePhotoIdx, photos.length - 1)] : null
  const activeColor = linkedToColors ? product.colors?.[activePhotoIdx] : null

  const selectPhoto = (index: number) => {
    setPhotoIdx(index)
    if (linkedToColors) colorSelection.setColorIndex(index)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {hasPhotos && activePhoto ? (
          <Image
            key={activePhoto}
            src={activePhoto}
            alt={
              activeColor
                ? `${product.title} ${t['pdp.gallery.in']} ${activeColor.name}`
                : `${product.title} ${t['pdp.gallery.photo']} ${activePhotoIdx + 1}`
            }
            fill
            loading="eager"
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
      {/* flex-wrap：照片多于 4 张时缩略图条的可折行宽度大于窄屏容器，
          换行而不是把页面撑出横向滚动（auto 轨道 min-content 防护）。 */}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={`${product.title} ${t['pdp.gallery.views']}`}
      >
        {hasPhotos
          ? photos.map((src, i) => {
              const current = activePhotoIdx === i
              const color = linkedToColors ? product.colors?.[i] : null
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => selectPhoto(i)}
                  aria-pressed={current}
                  aria-label={
                    color
                      ? `${t['pdp.gallery.show']} ${color.name}`
                      : `${t['pdp.gallery.show']} ${t['pdp.gallery.photo']} ${i + 1}`
                  }
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
          : VIEW_LABELS.map(({ view, labelKey }) => {
              const current = active === view
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => setActive(view)}
                  aria-pressed={current}
                  aria-label={t[labelKey]}
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
