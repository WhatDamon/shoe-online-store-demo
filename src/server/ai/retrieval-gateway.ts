// 检索的组合根：装配目录、默认仓库与嵌入能力，供编排层调用。
// 不放在 search/ 下的理由：search 只管「给定商品与嵌入怎么算相关性」；
// 「用哪个目录、哪个仓库、要不要开嵌入」是应用装配，属于 ai 这一侧。
import { catalog } from '@/server/catalog/adapter'
import { embed, embeddingsAvailable } from '@/server/search/embedder'
import { createDefaultRepository } from '@/server/search/repository'
import { retrieve } from '@/server/search/retrieval'
import type { Product } from '@/domain/product'

/** 检索 top-N 并取回完整商品（规格 §5：≤2k 目录内存余弦可行）。 */
export async function retrieveProducts(query: string, limit = 4): Promise<Product[]> {
  const products = await catalog().getProducts({})
  const hits = await retrieve(query, {
    products,
    repo: createDefaultRepository(),
    canEmbed: embeddingsAvailable,
    embed,
  })
  // 相关性下限：语义路径对全目录做余弦后按分排序、不过滤，余弦≈0/负分的无关行会占满 top-N，
  // 使 NO_MATCH 分支不可达。此处消费侧过滤（检索契约不变），阈值取 >0（嵌入尺度随模型而异，
  // 保守下限只剔除正交/负分噪声；更严格截断待引入原生向量后端时按已知模型标定）。
  const relevant = hits.filter((h) => h.score > 0)
  const found = await Promise.all(
    relevant.slice(0, limit).map((h) => catalog().getProductByHandle(h.handle)),
  )
  return found.filter((p): p is Product => p !== null)
}
