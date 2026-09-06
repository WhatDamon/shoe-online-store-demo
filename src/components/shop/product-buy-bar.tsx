'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'

interface ProductBuyBarProps {
  /** 服务端已算好的结算 URL；无 store 时为 null（占位 + 适配器就绪） */
  buyUrl: string | null
  /** 无 store 阶段语义标记（Shopify 未配置）：true 时走 demo 结算（Buy now → 支付码弹窗） */
  availableSoon: boolean
  /** 已选尺码的市场标签（如 "US 9"）；未选为 null，用于 aria-live 说明 */
  selectedLabel: string | null
  /** 已选颜色名（多色款）；未选/单色款为 null */
  colorName?: string | null
  /** 结算弹窗上下文（可选）：商品名与展示价。demo 结算不发起真实支付。 */
  productTitle?: string
  priceLabel?: string
}

// 无 store 阶段（2026-09 用户决策：Shopify 搁置、Vercel 走自定义选购演示）：
// buyUrl 为 null → “Buy now” → 弹出 demo 结算（占位支付码，不可真付款）；
// Shopify 相关小字已删除（不再出现 "Checkout lands on our Shopify store."）。
// 选尺码后仍可 Buy now，选择结果经 role="status"（aria-live polite）向读屏说明。
// 未来配置 Shopify 后 buyUrl 非空 → 直接渲染 <a href>（休眠路径，保持不变）。

/** dialog 内可聚焦元素（与 care-instructions 同一轻量 selector，无依赖）。 */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

export function ProductBuyBar({
  buyUrl,
  availableSoon,
  selectedLabel,
  colorName = null,
  productTitle,
  priceLabel,
}: ProductBuyBarProps) {
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // 关闭并还原焦点到 Buy now 按钮（WCAG 2.4.3 Focus Order）。
  const close = useCallback(() => {
    setCheckoutOpen(false)
    triggerRef.current?.focus()
  }, [])

  // 焦点圈闭 + Escape（与 care-instructions 同模式，a11y 门禁约束）。
  useEffect(() => {
    if (!checkoutOpen) return
    const dialog = dialogRef.current
    if (!dialog) return
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
  }, [checkoutOpen, close])

  // 休眠路径：真实 Shopify 结算 URL（adapter 契约保留，未配置时恒不命中）。
  if (buyUrl && !availableSoon) {
    return (
      <a href={buyUrl} className={buttonVariants({ className: 'w-full py-2.5 text-base' })}>
        Add to bag
      </a>
    )
  }

  const selection = [selectedLabel, colorName].filter(Boolean)

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        ref={triggerRef}
        type="button"
        onClick={() => setCheckoutOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={checkoutOpen}
        className="w-full py-2.5 text-base"
      >
        Buy now
      </Button>
      <p role="status" className="min-h-4 text-xs leading-5 text-neutral-500">
        {selection.length > 0 ? `${selection.join(' · ')} selected` : ''}
      </p>

      {checkoutOpen ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Demo checkout"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={() => close()}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-ink">Demo checkout</h2>
              <button
                type="button"
                onClick={() => close()}
                aria-label="Close demo checkout"
                className="rounded-full p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
              >
                <XIcon aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-3 px-5 py-5">
              {productTitle ? (
                <p className="text-center text-sm font-medium text-ink">
                  {productTitle}
                  {priceLabel ? (
                    <span className="ml-1.5 font-normal text-neutral-500">{priceLabel}</span>
                  ) : null}
                </p>
              ) : null}
              <div className="rounded-xl bg-white p-3">
                <Image
                  src="/payments/checkout-demo-qr.png"
                  alt="Payment QR code (demo)"
                  width={279}
                  height={279}
                  className="h-auto w-60 max-w-full sm:w-72"
                />
              </div>
              <p className="text-center text-sm leading-6 text-neutral-600">
                Scan to complete this demo order — the live payment QR replaces this one before
                launch.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
