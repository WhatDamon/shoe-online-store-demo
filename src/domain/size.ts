// 尺码域：canonical（EU 整档 35–48）↔ 各显示体系的换算，以及「我的尺码」的 mm 锚数学。
//
// 这两半原本分居 server/catalog/size-charts.ts 与 lib/my-size.ts，却共享同一张 mm 锚表
// 与同一套 EU↔US round-trip 关系 —— 只改一侧的换算规则，另一侧会悄悄漂移。
// 本模块是纯函数 + 常量、无任何 IO，因而可被 'use client' 组件直接 import。
import { market } from '@/lib/market'
import type { CanonicalSize, SizeSystem } from '@/domain/product'
import { sizeRows } from '@/domain/size-fixture'

const rowBySystem = (key: SizeSystem, value: number) =>
  sizeRows.find((r) => r.systems[key] === value)
const rowByEU = (eu: CanonicalSize) => sizeRows.find((r) => r.systems.EU === eu)

/**
 * canonical(EU) → 目标系统数值；目标为 EU 时接受 US 市场数值做 mm 锚往返
 * （EU42 → US8.5 → EU42 精确还原）。
 * 参数放宽为 number | null：表内 canonical(35–48) 恒可换算；null/表外值返回 null
 * （供 EU↔显示系统往返链组成，见 golden round-trip 用例）。
 */
export function convert(canonical: CanonicalSize | null, system: SizeSystem): number | null {
  if (canonical == null) return null
  const row = rowByEU(canonical)
  if (row) return row.systems[system]
  if (system === 'EU') {
    const usRow = rowBySystem('US', canonical) // 非 canonical 入参按默认市场 US 解释（round-trip）
    return usRow ? usRow.systems.EU : null
  }
  return null
}

/** 某系统数值（如 "US 9"）→ canonical EU；表内无该档返回 null */
export function toEU(value: number, system: SizeSystem): CanonicalSize | null {
  const row = rowBySystem(system, value)
  return row ? (row.systems.EU as CanonicalSize) : null
}

/** 输入 EU 需求码，返回最接近的 in-stock canonical EU */
export function nearestCanonical(wanted: number, available: CanonicalSize[]): CanonicalSize | null {
  if (!available.length) return null
  return available.reduce((best, a) => (Math.abs(a - wanted) < Math.abs(best - wanted) ? a : best))
}

// cm 脚长 → EU 近似：EU = (cm+2)×1.5，取整到整档（.5 向下靠 fixture 整档，27cm → 43）；
// 随后由调用方 nearestCanonical 收口到实际 in-stock EU。
function euFromCm(cm: number): CanonicalSize {
  return Math.floor((cm + 2) * 1.5) as CanonicalSize
}

/** 从消费者一句话里抽尺码意图（US/EU/UK/cm/JP 半码）→ canonical EU；抽不到返回 null */
export function parseSizeHint(text: string): CanonicalSize | null {
  const cm = text.match(/(\d{2}(?:\.\d)?)\s*cm/i)
  if (cm) return euFromCm(Number(cm[1]))
  const us = text.match(/\b(?:us|men's?|m)\s*(\d{1,2}(?:\.5)?)\b/i)
  if (us) return toEU(Number(us[1]), 'US')
  const eu = text.match(/\b(?:eu|size)\s*(\d{1,2})\b/i)
  if (eu) return Number(eu[1]) as CanonicalSize
  const jp = text.match(/\bjp\s*(\d{2}(?:\.5)?)\b/i)
  if (jp) return toEU(Number(jp[1]), 'JP')
  return null
}

/** 当前市场体系的全部档位选项（展示标签 + canonical）：如 US → "US 5"…"US 12.5"。供 /shop 筛选栏等消费。 */
export const availableSizesForSystem = (
  system: SizeSystem,
): { label: string; canonical: CanonicalSize }[] =>
  sizeRows.map((r) => ({
    label: `${system} ${r.systems[system]}`,
    canonical: r.systems.EU as CanonicalSize,
  }))

/**
 * canonical(EU) → 市场系统的显示标签。绝不裸写 EU 数字：同号易与中国码混读。
 *
 * 换算表查不到该码时退回显式 EU 标注，而不是拼出 "US null" —— 这是所有调用点共用的
 * 兜底，调用方不必各自再写一遍。当前规格覆盖 EU 35–48 全通，属防御分支。
 */
export const sizeLabel = (eu: CanonicalSize, system: SizeSystem = market.sizeSystem): string => {
  const v = convert(eu, system)
  return v == null ? `EU ${eu}` : `${system} ${v}`
}

/**
 * canonical 尺码集合 → 人读区间标签（如 "US 8.5–10.5"）；单档只显示该档；空集合 → null。
 *
 * 直接由 canonical 求 min/max，不经「先渲染标签、再用正则解析回系统」——
 * 那等于从自己的输出里恢复已知信息，也是同一规则在多处实现漂移的根源。
 */
export function sizeRangeFromCanonical(
  sizes: readonly CanonicalSize[],
  system: SizeSystem = market.sizeSystem,
): string | null {
  if (!sizes.length) return null
  const lo = Math.min(...sizes) as CanonicalSize
  const hi = Math.max(...sizes) as CanonicalSize
  if (lo === hi) return sizeLabel(lo, system)
  const loLabel = convert(lo, system)
  const hiLabel = convert(hi, system)
  if (loLabel == null || hiLabel == null) return null
  return `${system} ${loLabel}–${hiLabel}`
}

// ── 「我的尺码」：以脚长 mm 为单一事实源。任何体系都可由同一张表派生，无需按市场各存一份码。
// 边界由 fixture 首末行**派生**而非另写一遍字面量：给表补一档时上下界自动跟着走。
export const MY_SIZE_MIN_MM = sizeRows[0].mm // 表内最小脚长（EU 35）
export const MY_SIZE_MAX_MM = sizeRows[sizeRows.length - 1].mm // 表内最大脚长（EU 48）

/**
 * 最近的一行：|footMm - row.mm| 最小；表外（过小/过大）返回 null。
 * 表外不捏造一个不在表内的码，由 UI 给出诚实提示。
 */
export const footMmRow = (mm: number): (typeof sizeRows)[number] | null => {
  if (!Number.isFinite(mm) || mm < MY_SIZE_MIN_MM || mm > MY_SIZE_MAX_MM) return null
  let best: (typeof sizeRows)[number] = sizeRows[0]
  let bestDist = Infinity
  for (const row of sizeRows) {
    const dist = Math.abs(row.mm - mm)
    if (dist < bestDist) {
      best = row
      bestDist = dist
    }
  }
  return best
}

/** 脚长 mm → canonical EU（表内就近取档；表外 null）。 */
export const footMmToEU = (mm: number): CanonicalSize | null => footMmRow(mm)?.systems.EU ?? null

/** 脚长 mm → 指定体系的数值（表内就近换算；表外 null）。 */
export const footMmToSystem = (mm: number, system: SizeSystem): number | null => {
  const row = footMmRow(mm)
  return row ? (row.systems[system] as number) : null
}
