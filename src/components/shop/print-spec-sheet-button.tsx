'use client'

import { Printer } from 'lucide-react'

/**
 * 「Print / Save as PDF」触发（决策：PDP 内打印规格，浏览器原生打印/存 PDF）。
 * 图标按钮形态，位于商品列标题行右上、与 WishlistButton 并列（用户 2026-09-06
 * 选定：移出详情区、右上角轻量图标最简洁）。纯 client：调用 window.print()，
 * 由 @media print 样式只渲染打印区块（见 globals.css .print-spec-sheet 规则）。
 * 不依赖任何环境/路由：无 key 也可用（真数据 + 打印）。
 */
export function PrintSpecSheetButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      aria-label="Print / Save as PDF"
      title="Print / Save as PDF"
      className="inline-flex items-center justify-center rounded-full p-2 text-neutral-600 transition-colors hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
    >
      <Printer aria-hidden="true" className="size-5" strokeWidth={1.5} />
    </button>
  )
}
