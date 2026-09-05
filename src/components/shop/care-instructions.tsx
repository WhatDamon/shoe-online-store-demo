'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import carePoster from '@/assets/product-care-instructions.webp'

// 护理说明海报（决策 #19）：站点通用资产，每个 PDP 详情区提供查看入口。
// 海报为竖版长图 → 点击以全屏遮罩展示（可滚动/可关闭），不占 PDP 首屏（克制 P1）。
// import 在 vitest（asset→string）与 Next（{src,height,width}）下形态不同 → 统一取 src 字符串，
// 显式给出按原图等比缩放的显示尺寸（原 2480×3507 ÷2），避免依赖 import 形态的宽高字段。
const POSTER_SRC = typeof carePoster === 'string' ? carePoster : carePoster.src
const POSTER_WIDTH = 1240
const POSTER_HEIGHT = 1754

export function CareInstructionsButton() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
      >
        Care instructions
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Care instructions"
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-2xl bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold text-ink">Care instructions</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close care instructions"
                className="rounded-full p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
              >
                <XIcon aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto bg-white">
              <Image
                src={POSTER_SRC}
                alt="How to care for your shoes"
                width={POSTER_WIDTH}
                height={POSTER_HEIGHT}
                className="h-auto w-full"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
