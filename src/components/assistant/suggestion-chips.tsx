'use client'

import type { Mode } from '@/domain/chat-events'
import { useMessages } from '@/components/i18n/locale-provider'
import type { Messages } from '@/i18n/messages'

// 开场建议 chips（消费端措辞——不出现 "AI"）。
// size-fit/outfit 需要商品上下文（服务端要求 product 引用），无上下文时不可达，
// 由调用方按 product 是否存在选组合（GENERAL 或 CONTEXT 或全量）。
// 末尾两枚为店务客服入口（克制客服 P1：无 AI 字样、不需商品上下文），
// 与找鞋 chips 并列于 welcome 区；welcome 隐含后由用户自由输入触发同模式。
//
// 表里存**词典键**而不是字面文案：label 既渲染成按钮文字，也作为该轮的用户消息发给服务端
// （`onPick(mode, label)`），所以它必须来自词典单源（与 `src/lib/site.ts` 的 nav 同款键表）。
type Suggestion = { mode: Mode; labelKey: keyof Messages }

export const SUGGESTIONS: Suggestion[] = [
  { mode: 'size-fit', labelKey: 'assistant.chip.findMySize' },
  { mode: 'outfit', labelKey: 'assistant.chip.styleItWith' },
  { mode: 'shopping', labelKey: 'assistant.chip.helpMePick' },
  { mode: 'find-shoes', labelKey: 'assistant.chip.everydaySneakers' },
  { mode: 'support', labelKey: 'assistant.chip.shippingReturns' },
  { mode: 'support', labelKey: 'assistant.chip.careGuide' },
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
  items?: Suggestion[]
}) {
  const t = useMessages()
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((s) => (
        <li key={s.labelKey}>
          <button
            type="button"
            onClick={() => onPick(s.mode, t[s.labelKey])}
            className="rounded-full border border-neutral-300 bg-surface px-3.5 py-1.5 text-[13px] text-neutral-800 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            {t[s.labelKey]}
          </button>
        </li>
      ))}
    </ul>
  )
}
