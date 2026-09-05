// GET /api/catalog?handles=dc-1001,dc-1002 — 只读商品摘要（决策：/saved 收藏页等
// 客户端场景需要按 handle 拉取展示数据；目录数据在 server（DB/seed），UI 无本地副本）。
// 返回最小展示字段（不含价/不含 store token）：保持顺序、去重、过滤未知 handle、
// 上限 30（防滥用；全目录仅 29 款）。storeAvailable = 该 handle 已映射商店 Buy（env 配置时）。
import { convert } from '@/server/catalog/size-charts'
import type { CanonicalSize } from '@/server/catalog/types'
import { listProductsForMarket } from '@/server/catalog/service'
import { shopifyBuyConfigFor } from '@/server/catalog/shopify-buy'
import { market } from '@/lib/market'

export const dynamic = 'force-dynamic' // 目录来自 DB（seed/DB 随运行变更），不做 SSG 缓存

const MAX_HANDLES = 30

export interface CatalogSummary {
  handle: string
  title: string
  subtitle: string
  /** 本地首图路径（/products/<handle>/…）或 null（无图款 → 调用方 SVG 兜底）。 */
  image: string | null
  colorCount: number
  photoCount: number
  /** 码段（market 体系，如 "US 4.5–9.5"）；无码款 null。 */
  sizeRange: string | null
  /** 已映射商店产品（Buy 全接管 PDP 时显示徽记）。 */
  storeAvailable: boolean
}

export async function GET(req: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return Response.json([]) // 无效 URL → 空列表（只读端点，不抛 500）
  }
  const raw = (url.searchParams.get('handles') ?? '').trim()
  if (!raw) return Response.json([])
  // 去重并保序；超上限只取前 30（防超大参数；后续有需要再谈分页）
  const handles = [
    ...new Set(
      raw
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h !== ''),
    ),
  ].slice(0, MAX_HANDLES)
  if (!handles.length) return Response.json([])

  const all = await listProductsForMarket({})
  const byHandle = new Map(all.map((p) => [p.handle, p]))
  const out: CatalogSummary[] = []
  for (const handle of handles) {
    const p = byHandle.get(handle)
    if (!p) continue // 未知 handle 静默过滤（收藏过期项不 404 崩页）
    const lo = p.sizes.length
      ? convert(Math.min(...p.sizes) as CanonicalSize, market.sizeSystem)
      : null
    const hi = p.sizes.length
      ? convert(Math.max(...p.sizes) as CanonicalSize, market.sizeSystem)
      : null
    out.push({
      handle: p.handle,
      title: p.title,
      subtitle: p.subtitle,
      image: p.images?.[0] ?? null,
      colorCount: p.colors?.length ?? 0,
      photoCount: p.images?.length ?? 0,
      sizeRange: lo != null && hi != null ? `${market.sizeSystem} ${lo}–${hi}` : null,
      storeAvailable: shopifyBuyConfigFor(p.handle) != null,
    })
  }
  return Response.json(out)
}
