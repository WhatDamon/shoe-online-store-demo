import { cosine } from './vector'
import { catalog } from '@/server/catalog/adapter'
import { embed, embeddingsAvailable } from './embedder'
import { keywordSearch } from './keyword'
import { createDefaultRepository } from './repository'
import type { Product } from '@/server/catalog/types'

export interface RetrievalResult {
  handle: string
  score: number
}

export const textualContent = (p: Product) =>
  [p.title, p.subtitle, p.productType, ...p.tags, ...p.features, p.description]
    .join(' ')
    .toLowerCase()
export const hashText = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

type Repo = ReturnType<typeof createDefaultRepository>

export async function retrieve(
  query: string,
  opts: { embedIfAvailable?: boolean } = { embedIfAvailable: true },
  repo: Repo = createDefaultRepository(),
): Promise<RetrievalResult[]> {
  const products = await catalog.getProducts({}) // 规格 §5：≤2k 目录内存余弦可行
  if (opts.embedIfAvailable && (await embeddingsAvailable())) {
    const model = process.env.AI_EMBEDDING_MODEL ?? ''
    const [qVec] = await embed([query])
    const cached = new Map((await repo.allEmbeddings(model)).map((r) => [r.productId, r]))
    for (const p of products) {
      const h = hashText(textualContent(p))
      const hit = cached.get(p.id)
      if (!hit || hit.contentHash !== h) {
        const [v] = await embed([textualContent(p)]) // 懒计算并缓存；contentHash 变则自动重算
        await repo.upsertEmbedding({
          productId: p.id,
          contentHash: h,
          model,
          vector: v,
        })
      }
    }
    const rows = await repo.allEmbeddings(model)
    const byId = new Map(products.map((p) => [p.id, p]))
    return rows
      .map((r) => ({
        handle: byId.get(r.productId)?.handle ?? r.productId,
        score: cosine(qVec, r.vector),
      }))
      .sort((a, b) => b.score - a.score)
  }
  return keywordSearch(query, products) // 无 embedding 能力 → 关键词降级（规格 §8.3.4）
}
