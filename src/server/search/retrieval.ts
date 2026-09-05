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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 语义检索：整库懒 embed（缺/变更一次批量补算，勿逐条请求——省请求数、避开限流）。 */
async function semanticRetrieve(
  query: string,
  products: Product[],
  repo: Repo,
): Promise<RetrievalResult[]> {
  const model = process.env.AI_EMBEDDING_MODEL ?? ''
  const [qVec] = await embed([query])
  const cached = new Map((await repo.allEmbeddings(model)).map((r) => [r.productId, r]))
  const missing: { product: Product; hash: string }[] = []
  for (const p of products) {
    const h = hashText(textualContent(p))
    const hit = cached.get(p.id)
    if (!hit || hit.contentHash !== h) missing.push({ product: p, hash: h })
  }
  if (missing.length) {
    // 瞬时限流（429/5xx）：小退避后重试一次；仍失败抛出让上层降级关键词。
    const vecs = await embed(missing.map((m) => textualContent(m.product))).catch(async (e) => {
      const msg = String((e as Error).message ?? '')
      if (/\b(429|5\d\d)\b/.test(msg)) {
        await sleep(1_200)
        return embed(missing.map((m) => textualContent(m.product)))
      }
      throw e
    })
    for (let i = 0; i < missing.length; i++) {
      await repo.upsertEmbedding({
        productId: missing[i].product.id,
        contentHash: missing[i].hash,
        model,
        vector: vecs[i],
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

export async function retrieve(
  query: string,
  opts: { embedIfAvailable?: boolean } = { embedIfAvailable: true },
  repo: Repo = createDefaultRepository(),
): Promise<RetrievalResult[]> {
  const products = await catalog.getProducts({}) // 规格 §5：≤2k 目录内存余弦可行
  if (opts.embedIfAvailable && (await embeddingsAvailable())) {
    try {
      return await semanticRetrieve(query, products, repo)
    } catch (e) {
      // 语义侧故障（限流/过载/瞬时）不拖垮导购：本次请求降级关键词（规格 §8.3.4）。
      console.warn(
        '[retrieval] embeddings failed (%s) — keyword fallback for this request',
        (e as Error).message ?? e,
      )
    }
  }
  return keywordSearch(query, products) // 无 embedding 能力 → 关键词降级（规格 §8.3.4）
}
