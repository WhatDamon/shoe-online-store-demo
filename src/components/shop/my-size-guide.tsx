'use client'

import { useState, useSyncExternalStore } from 'react'
import type { SizeSystem } from '@/domain/product'
import { market } from '@/lib/market'
import { footMmToSystem, MY_SIZE_MAX_MM, MY_SIZE_MIN_MM } from '@/domain/size'
import { mySize, MY_SIZE_UI_MAX_MM, MY_SIZE_UI_MIN_MM, setMySize } from '@/lib/my-size'
import { useMessages } from '@/components/i18n/locale-provider'

const SYSTEMS: SizeSystem[] = ['US', 'EU', 'UK', 'JP', 'CN']

const fmt = (v: number | null): string => (v == null ? '—' : String(v))

/**
 * PDP 尺码选择旁的「My size」行（克制、不占首屏）：原生 <details> 展开，
 * 脚长 mm 滑杆 + 数值输入联动 + 五体系实时换算；保存 → localStorage
 * （evoloop:foot-mm），全站（/shop chips、Select-size 高亮、Find my size 预填）
 * 消费同一快照。零 JS 也可展开（<details>）。
 */
export function MySizeGuide() {
  const t = useMessages()
  const savedMm = useSyncExternalStore(
    mySize.subscribe,
    mySize.getSnapshot,
    mySize.getServerSnapshot,
  )
  const marketSys = market.sizeSystem
  // 草稿：已保存则从其出发；未保存给表内常见默认（265mm，演示中段）
  const [draft, setDraft] = useState(savedMm ?? 265)
  const mm = Number.isFinite(draft)
    ? Math.min(MY_SIZE_UI_MAX_MM, Math.max(MY_SIZE_UI_MIN_MM, Math.round(draft)))
    : 265
  const inTable = mm >= MY_SIZE_MIN_MM && mm <= MY_SIZE_MAX_MM

  return (
    <details className="group rounded-xl border border-neutral-200 bg-surface open:pb-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-neutral-800 marker:content-none [&::-webkit-details-marker]:hidden">
        <span>
          {savedMm != null ? (
            <>
              {t['pdp.mySize.saved']} {fmt(footMmToSystem(savedMm, marketSys))} {marketSys}
            </>
          ) : (
            t['pdp.mySize.trigger']
          )}
        </span>
        {/* 12px 真实文字：必须达 4.5:1，用仓库自订的正文下限 neutral-500（浅 4.74 / 深 4.66）。 */}
        <span className="text-xs font-normal text-neutral-500 group-open:hidden">
          {savedMm != null ? t['pdp.mySize.change'] : t['pdp.mySize.guidance']}
        </span>
        <span
          aria-hidden="true"
          className="text-neutral-400 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="flex flex-col gap-3 px-3 pt-1">
        {/* 量脚示意：纯内联 SVG（无新图片资产，克制） */}
        <div className="flex items-center gap-3 rounded-lg bg-canvas p-2.5">
          <svg
            viewBox="0 0 64 28"
            role="img"
            aria-label={t['pdp.mySize.measureAlt']}
            className="h-10 w-auto shrink-0 text-neutral-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M6 22 C10 10, 20 6, 34 6 C46 6, 56 12, 58 20" strokeLinecap="round" />
            <path d="M6 22 L12 26 M6 22 L2 16" strokeLinecap="round" />
            <path d="M38 8 L38 26 M34 24 L44 24" strokeDasharray="2 2" />
          </svg>
          <p className="text-xs leading-5 text-neutral-600">{t['pdp.mySize.measureCopy']}</p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between text-xs text-neutral-600">
            <span>{t['pdp.mySize.footLength']}</span>
            <span className="font-medium tabular-nums text-ink">
              {mm}mm{inTable ? '' : ` ${t['pdp.mySize.outsideAdult']}`}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={MY_SIZE_UI_MIN_MM}
              max={MY_SIZE_UI_MAX_MM}
              step={1}
              value={mm}
              aria-label={t['pdp.mySize.footLengthAria']}
              onChange={(e) => setDraft(Number(e.target.value))}
              className="h-8 w-full accent-brand"
            />
            <input
              type="number"
              inputMode="numeric"
              min={MY_SIZE_UI_MIN_MM}
              max={MY_SIZE_UI_MAX_MM}
              value={mm}
              aria-label={t['pdp.mySize.footLengthNumberAria']}
              onChange={(e) => setDraft(Number(e.target.value))}
              className="h-8 w-20 rounded-lg border border-neutral-200 bg-canvas px-2 text-sm text-ink focus:border-neutral-400 focus:outline-none"
            />
          </span>
        </label>

        {/* 五体系换算行（表外显示 —，诚实不伪造）。体系名 US/EU/UK/JP/CN 是领域事实，不翻译。 */}
        <dl className="grid grid-cols-5 gap-1.5 text-center">
          {SYSTEMS.map((s) => (
            <div key={s} className="rounded-lg border border-neutral-200 bg-canvas px-1 py-1.5">
              <dt className="text-[10px] uppercase tracking-wide text-neutral-500">{s}</dt>
              <dd className="text-xs font-medium tabular-nums text-ink">
                {inTable ? fmt(footMmToSystem(mm, s)) : '—'}
              </dd>
            </div>
          ))}
        </dl>
        {!inTable ? (
          <p className="text-xs leading-5 text-neutral-500">
            {/* 区间 `US 4.5–12.5` 是领域事实（尺码体系不得因语言漂移，ADR 0008 决策 6），
                故留在组件里；它两侧的括号归句子片段（与 `shop.gift.*Lead/Tail` 同一口径）。 */}
            {t['pdp.mySize.outOfRangeLead']}US 4.5–12.5{t['pdp.mySize.outOfRangeTail']}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMySize(mm)}
            className="inline-flex items-center justify-center rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-canvas transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            {savedMm != null ? t['pdp.mySize.update'] : t['pdp.mySize.save']}
          </button>
          {savedMm != null ? (
            <button
              type="button"
              onClick={() => setMySize(null)}
              className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
            >
              {t['pdp.mySize.remove']}
            </button>
          ) : null}
        </div>
      </div>
    </details>
  )
}
