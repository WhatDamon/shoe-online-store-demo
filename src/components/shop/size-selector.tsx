'use client'

import type { CanonicalSize } from '@/server/catalog/types'

interface SizeOption {
  value: CanonicalSize
  label: string
}

interface SizeSelectorProps {
  sizeOptions: SizeOption[]
  selected: CanonicalSize | null
  onChange: (value: CanonicalSize) => void
  /** 已保存「我的尺码」对应的 canonical（无则 null）：命中 chip 加品牌描边 + Your size 标记。 */
  match?: CanonicalSize | null
}

// PDP 尺码选择：可访问 radio group（fieldset/legend）。受控选择；name="sizes"
// 保证组内互斥。真实 input 为 sr-only，键盘焦点落在 input 上，视觉 chip 以
// peer-focus-visible 提供可见轮廓。match（我的码）命中项以品牌色描边区分，
// 选中态仍以 ink 底反白覆盖，二者可叠加不冲突。
export function SizeSelector({ sizeOptions, selected, onChange, match = null }: SizeSelectorProps) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm font-medium text-ink">Select size</legend>
      <div className="flex flex-wrap gap-2">
        {sizeOptions.map((option) => {
          const active = selected === option.value
          const isMatch = match != null && match === option.value
          return (
            <label key={option.value} className="group cursor-pointer">
              <input
                type="radio"
                name="sizes"
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                aria-label={isMatch ? `${option.label} (your size)` : option.label}
                className="peer sr-only"
              />
              <span
                data-your-size={isMatch ? 'true' : undefined}
                className={`block rounded-lg border px-3 py-2 text-sm transition-colors group-hover:border-neutral-400 group-focus-within:outline group-focus-within:outline-2 group-focus-within:outline-offset-2 group-focus-within:outline-neutral-400 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-canvas ${
                  isMatch
                    ? 'border-brand text-brand peer-checked:text-canvas'
                    : 'border-neutral-300 text-neutral-800'
                }`}
              >
                {option.label}
                {isMatch ? (
                  <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 align-middle text-[10px] font-medium text-canvas">
                    Your size
                  </span>
                ) : null}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
