'use client'

import type { Mode } from '@/server/ai/events'

// 开场建议 chips（规格 §8.1，消费端措辞——不出现 "AI"）。
// size-fit/outfit 需要商品上下文（服务端要求 product 引用），无上下文时不可达，
// 由调用方按 product 是否存在选组合（GENERAL 或 CONTEXT 或全量）。
// 末尾两枚为店务客服入口（克制客服 P1：无 AI 字样、不需商品上下文），
// 与找鞋 chips 并列于 welcome 区；welcome 隐含后由用户自由输入触发同模式。
export const SUGGESTIONS: { mode: Mode; label: string }[] = [
  { mode: 'size-fit', label: 'Find my size' },
  { mode: 'outfit', label: 'Style it with' },
  { mode: 'shopping', label: 'Help me pick' },
  { mode: 'find-shoes', label: 'Everyday sneakers' },
  { mode: 'support', label: 'Shipping & returns' },
  { mode: 'support', label: 'Care guide' },
]

/** 无需商品上下文的通用建议（support 客服入口不需 product，自动保留）。 */
export const GENERAL_SUGGESTIONS = SUGGESTIONS.filter(
  (s) => s.mode !== 'size-fit' && s.mode !== 'outfit',
)

/** 需要商品上下文的建议（Find my size / Style it with）。 */
export const CONTEXT_SUGGESTIONS = SUGGESTIONS.filter(
  (s) => s.mode === 'size-fit' || s.mode === 'outfit',
)

export function SuggestionChips({
  onPick,
  items = SUGGESTIONS,
}: {
  onPick: (mode: Mode, label: string) => void
  items?: { mode: Mode; label: string }[]
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((s) => (
        <li key={s.label}>
          <button
            type="button"
            onClick={() => onPick(s.mode, s.label)}
            className="rounded-full border border-neutral-300 bg-surface px-3.5 py-1.5 text-[13px] text-neutral-800 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
