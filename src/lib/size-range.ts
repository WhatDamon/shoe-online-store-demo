import { sizeRangeFromCanonical } from '@/domain/size'
import type { CanonicalSize } from '@/server/catalog/types'

/**
 * 商品可用尺码区间的人读标签（卡片角标），如 "US 8.5–10.5" / "EU 43–45"。
 *
 * 形参沿用 ProductView.sizeOptions 的形状（label 不再参与计算，保留以稳定调用面）：
 * 区间规则单一来源在 domain/size，显示系统与 service 渲染这些标签时一致。
 */
export function sizeRangeLabel(
  sizeOptions: { value: CanonicalSize; label: string }[],
): string | null {
  return sizeRangeFromCanonical(sizeOptions.map((o) => o.value))
}
