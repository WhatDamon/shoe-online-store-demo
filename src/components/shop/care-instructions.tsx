'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'
import carePoster from '@/assets/product-care-instructions.webp'

// 护理说明海报（决策 #19）：站点通用资产，每个 PDP 详情区提供查看入口。
// 海报为竖版长图 → 点击以全屏遮罩展示（可滚动/可关闭），不占 PDP 首屏（克制 P1）。
// import 在 vitest（asset→string）与 Next（{src,height,width}）下形态不同 → 统一取 src 字符串，
// 显式给出按原图等比缩放的显示尺寸（原 2480×3507 ÷2），避免依赖 import 形态的宽高字段。
const POSTER_SRC = typeof carePoster === 'string' ? carePoster : carePoster.src
const POSTER_WIDTH = 1240
const POSTER_HEIGHT = 1754

/** dialog 内可聚焦元素（无依赖的轻量 selector，覆盖按钮/链接/表单控件）。 */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

export function CareInstructionsButton() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // 关闭并还原焦点到触发按钮（WCAG 2.4.3 Focus Order）。
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // 焦点圈闭（WCAG 2.1.2）：打开时移入 dialog，Tab/Shift+Tab 在圈内循环；
  // Escape 关闭。依赖 open 状态重挂监听，关闭后无需清理还原（close 已负责）。
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    // 打开后把焦点交给 dialog 内的关闭按钮（首可聚焦元素）。
    // 直接 focus：effect 在 React 提交后运行，dialog 已挂载；rAF 在 jsdom 不触发，测试不可靠。
    focusableIn(dialog)[0]?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableIn(dialog)
      if (items.length === 0) return
      const active = document.activeElement as HTMLElement | null
      const idx = active ? items.indexOf(active) : -1
      if (e.shiftKey && (idx <= 0 || idx === -1)) {
        e.preventDefault()
        items[items.length - 1]?.focus()
      } else if (!e.shiftKey && (idx === items.length - 1 || idx === -1)) {
        e.preventDefault()
        items[0]?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return (
    <>
      <button
        ref={triggerRef}
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
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Care instructions"
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 sm:p-6"
          onClick={() => close()}
        >
          <div
            className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-2xl bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold text-ink">Care instructions</h2>
              <button
                type="button"
                onClick={() => close()}
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
