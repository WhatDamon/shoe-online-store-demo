// 把商品投影成「给模型看的事实块」与「给用户看的结果卡」。两者口径必须一致：只含可核实
// 原始数据，绝不携带价格（价格只存在于详情页与店铺，AI 不传播 demo 价段），也不虚构材质/
// 3D 声明（实拍目录）。纯函数，无 IO，可直接单测。
import { sizeRangeFromCanonical } from '@/domain/size'
import type { Product } from '@/domain/product'
import type { ProductCard } from '@/domain/chat-events'

/** 结果卡：真实首图 + 真实元数据。images 为空（目前目录无此情形）→ imageKind 'svg'，
 * 由 UI 以 ProductVisual 色卡视觉兜底。 */
export const toCard = (p: Product): ProductCard => ({
  handle: p.handle,
  title: p.title,
  subtitle: p.subtitle,
  image: p.images?.[0] ?? null,
  imageKind: (p.images?.length ?? 0) > 0 ? 'photo' : 'svg',
  photoCount: p.images?.length ?? 0,
  sizeRange: sizeRangeFromCanonical(p.sizes),
  colorCount: p.colors?.length ?? 0,
  palette: p.visual.palette,
})

/** digest 注入真实字段（标题/品类/描述），绝不携带价格。 */
export const digestLines = (ps: Product[]): string =>
  ps.map((p) => `- ${p.title} (${p.productType}): ${p.description}`).join('\n')

/** 注入给模型的商品事实（size-fit / outfit / shopping 锚定共用）：真实货号（handle 大写，
 * 29/29 等于供应商码）、描述、真实配色名清单（超 6 色截断保留总数）、码段市场标签、照片数、
 * 真实特性前 5 条。 */
export const productContextOf = (v: Product): string => {
  const colors = (v.colors ?? []).map((c) => c.name)
  const facts: string[] = [
    `Product: ${v.title}.`,
    v.description,
    `Code: ${v.handle.toUpperCase()}.`,
  ]
  if (colors.length > 0) {
    const shown =
      colors.length > 6
        ? `${colors.slice(0, 6).join(', ')}, … (${colors.length} total)`
        : colors.join(', ')
    facts.push(`Colors: ${shown}.`)
  }
  if (v.sizes.length > 0) {
    facts.push(`Available sizes: ${sizeRangeFromCanonical(v.sizes) ?? v.sizes.join(', ')}.`)
  }
  if (v.images?.length) facts.push(`Photos: ${v.images.length}.`)
  if (v.features.length > 0) facts.push(`Details: ${v.features.slice(0, 5).join('; ')}.`)
  return facts.join(' ')
}
