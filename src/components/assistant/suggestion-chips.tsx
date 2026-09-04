'use client'

import type { Mode } from '@/server/ai/events'

// 首次打开的会话开场建议（规格 §8.1 chips，消费端措辞——不出现 "AI"）。
export const SUGGESTIONS: { mode: Mode; label: string }[] = [
  { mode: 'size-fit', label: 'Find my size' },
  { mode: 'outfit', label: 'Style it with' },
  { mode: 'shopping', label: 'Help me pick' },
  { mode: 'find-shoes', label: 'Everyday sneakers under $150' },
]

export function SuggestionChips({
  onPick,
}: {
  onPick: (mode: Mode, label: string) => void
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {SUGGESTIONS.map((s) => (
        <li key={s.label}>
          <button
            type="button"
            onClick={() => onPick(s.mode, s.label)}
            className="rounded-full border border-neutral-300 bg-white px-3.5 py-1.5 text-[13px] text-neutral-800 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
