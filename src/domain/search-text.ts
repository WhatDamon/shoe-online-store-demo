import type { Product } from '@/domain/product'

/**
 * 商品的可搜索文本投影。
 *
 * 放在 domain 而非 search/：retrieval 依赖 keyword（语义失败降级关键词），
 * 因此这份共享投影不能栖身于任一 search 模块，否则成环。
 */
export const searchableText = (p: Product): string =>
  [p.title, p.subtitle, p.productType, ...p.tags, ...p.features, p.description]
    .join(' ')
    .toLowerCase()
