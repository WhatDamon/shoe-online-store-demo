'use client'

import type { CanonicalSize } from '@/server/catalog/types'

export interface SizeOption {
  value: CanonicalSize
  label: string
}

interface SizeSelectorProps {
  sizeOptions: SizeOption[]
  selected: CanonicalSize | null
  onChange: (value: CanonicalSize) => void
}

// PDP 尺码选择：可访问 radio group（fieldset/legend）。受控选择；name="sizes"
// 保证组内互斥。真实 input 为 sr-only，键盘焦点落在 input 上，视觉 chip 以
// peer-focus-visible 提供可见轮廓。
export function SizeSelector({ sizeOptions, selected, onChange }: SizeSelectorProps) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm font-medium text-ink">Select size</legend>
      <div className="flex flex-wrap gap-2">
        {sizeOptions.map((option) => {
          const active = selected === option.value
          return (
            <label key={option.value} className="group cursor-pointer">
              <input
                type="radio"
                name="sizes"
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span className="block rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 transition-colors group-hover:border-neutral-400 group-focus-within:outline group-focus-within:outline-2 group-focus-within:outline-offset-2 group-focus-within:outline-neutral-400 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-canvas">
                {option.label}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
