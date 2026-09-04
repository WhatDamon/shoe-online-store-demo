// 尺码换算纯函数：canonical（EU 整档 36–48）↔ 显示系统，经 size-fixture 的 mm 锚单表换算。
import { sizeRows } from './size-fixture'
import type { CanonicalSize, SizeSystem } from './types'

type Key = 'US' | 'EU' | 'UK' | 'JP' | 'CN'
const rowBySystem = (key: Key, value: number) => sizeRows.find((r) => r.systems[key] === value)
const rowByEU = (eu: CanonicalSize) => sizeRows.find((r) => r.systems.EU === eu)

/**
 * canonical(EU) → 目标系统数值；目标为 EU 时接受 US 市场数值做 mm 锚往返
 * （EU42 → US8.5 → EU42 精确还原）。
 * 参数放宽为 number | null：表内 canonical(36–48) 恒可换算；null/表外值返回 null
 * （供 EU↔显示系统往返链组成，见 golden round-trip 用例）。
 */
export function convert(canonical: CanonicalSize | null, system: SizeSystem): number | null {
  if (canonical == null) return null
  const row = rowByEU(canonical)
  if (row) return row.systems[system as Key] as number
  if (system === 'EU') {
    const usRow = rowBySystem('US', canonical) // 非 canonical 入参按默认市场 US 解释（round-trip）
    return usRow ? usRow.systems.EU : null
  }
  return null
}

/** 某系统数值（如 "US 9"）→ canonical EU；表内无该档返回 null */
export function toEU(value: number, system: SizeSystem): CanonicalSize | null {
  const row = rowBySystem(system as Key, value)
  return row ? (row.systems.EU as CanonicalSize) : null
}

/** 输入 EU 需求码，返回最接近的 in-stock canonical EU */
export function nearestCanonical(wanted: number, available: CanonicalSize[]): CanonicalSize | null {
  if (!available.length) return null
  return available.reduce((best, a) => (Math.abs(a - wanted) < Math.abs(best - wanted) ? a : best))
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
    label: `${system} ${r.systems[system as 'US' | 'EU' | 'UK' | 'JP' | 'CN']}`,
    canonical: r.systems.EU as CanonicalSize,
  }))

// cm 脚长 → EU 近似：EU = (cm+2)×1.5，取整到整档（.5 向下靠 fixture 整档，27cm → 43）；
// 随后由调用方 nearestCanonical 收口到实际 in-stock EU。
function euFromCm(cm: number): CanonicalSize {
  return Math.floor((cm + 2) * 1.5) as CanonicalSize
}
