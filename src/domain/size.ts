import { convert } from '@/server/catalog/size-charts'
import type { CanonicalSize, SizeSystem } from '@/server/catalog/types'
import { market } from '@/lib/market'

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
