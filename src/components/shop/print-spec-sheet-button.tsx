'use client'

/**
 * 「Print / Save as PDF」触发（决策：PDP 内打印规格，浏览器原生打印/存 PDF）。
 * 纯 client：调用 window.print()，由 @media print 样式只渲染打印区块
 * （见 globals.css .print-spec-sheet 规则）。克制文案，不占首屏（详情区
 * CareInstructions 旁）。不依赖任何环境/路由：无 key 也可用（真数据 + 打印）。
 */
export function PrintSpecSheetButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="text-sm font-medium text-ink underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
    >
      Print / Save as PDF
    </button>
  )
}
