/**
 * 商品可用尺码区间的人读标签（卡片角标），如 "US 8.5–10.5" / "EU 43–45"。
 * 规则：单档只显示该档；跨档共享同一尺寸体系时只保留一次体系前缀；
 * 其余（体系不同/无法解析）退化为完整 "A – B"。
 */
export function sizeRangeLabel(sizeOptions: { value: number; label: string }[]): string | null {
  if (sizeOptions.length === 0) return null
  const sorted = [...sizeOptions].sort((a, b) => a.value - b.value)
  const first = sorted[0].label
  const last = sorted[sorted.length - 1].label
  if (first === last) return first
  const split = (s: string): { system: string; size: string } | null => {
    const m = s.match(/^([A-Za-z]+)\s+([\d.]+)$/)
    return m ? { system: m[1], size: m[2] } : null
  }
  const a = split(first)
  const b = split(last)
  if (a && b && a.system === b.system) return `${a.system} ${a.size}–${b.size}`
  return `${first}–${last}`
}
