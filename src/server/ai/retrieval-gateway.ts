// 检索的组合根：装配目录、默认仓库与嵌入能力，供编排层调用。
// 不放在 search/ 下的理由：search 只管「给定商品与嵌入怎么算相关性」；
// 「用哪个目录、哪个仓库、要不要开嵌入」是应用装配，属于 ai 这一侧。
import { catalog } from '@/server/catalog/adapter'
import { embed, embeddingsAvailable, type EmbeddingProbeRunner } from '@/server/search/embedder'
import { createDefaultRepository } from '@/server/search/repository'
import { retrieve } from '@/server/search/retrieval'
import type { Product } from '@/domain/product'

export type EmbeddingRunner = <T>(texts: string[], operation: () => Promise<T>) => Promise<T>

export interface RetrievalOptions {
  /** Optional per-request budget wrapper for every probe and embedding call. */
  runEmbedding?: EmbeddingRunner
}

/** 检索 top-N 并取回完整商品（≤2k 目录内存余弦可行）。 */
export async function retrieveProducts(
  query: string,
  limit = 4,
  options: RetrievalOptions = {},
): Promise<Product[]> {
  const runEmbedding: EmbeddingRunner =
    options.runEmbedding ?? (async (_texts, operation) => operation())
  const runProbe: EmbeddingProbeRunner = (operation) => runEmbedding(['ping'], operation)
  const products = await catalog().getProducts({})
  const hits = await retrieve(query, {
    products,
    repo: createDefaultRepository(),
    canEmbed: () => embeddingsAvailable({ run: runProbe }),
    embed: (texts) => runEmbedding(texts, () => embed(texts)),
  })
  // 相关性下限：语义路径对全目录做余弦后按分排序、不过滤，余弦≈0/负分的无关行会占满 top-N，
  // 使 NO_MATCH 分支不可达。此处消费侧过滤（检索契约不变），阈值取 >0（嵌入尺度随模型而异，
  // 保守下限只剔除正交/负分噪声；更严格截断待引入原生向量后端时按已知模型标定）。
  const relevant = hits.filter((h) => h.score > 0)
  const byHandle = new Map(products.map((product) => [product.handle, product]))
  return relevant
    .slice(0, limit)
    .map((hit) => byHandle.get(hit.handle))
    .filter((product): product is Product => product !== undefined)
}
