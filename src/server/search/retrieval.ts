import { envStr } from '@/config'
import { searchableText } from '@/domain/search-text'
import type { Product } from '@/domain/product'
import { cosine, validateEmbeddingVectors } from './vector'
import { keywordSearch } from './keyword'
import type { Repository } from './repository'

export interface RetrievalResult {
  handle: string
  score: number
}

/** retrieve 的全部外部依赖，显式注入。
 * 此前用默认参数装配全局单例，测试只能靠操纵 env 与 mock 整个模块才能绕开。 */
export interface RetrievalDeps {
  products: Product[]
  repo: Repository
  /** 「这次能不能嵌入」由调用方（组合根）决定是否开启语义路径。 */
  canEmbed: () => Promise<boolean>
  embed: (texts: string[], expectedDimension?: number) => Promise<number[][]>
  signal?: AbortSignal
}

export const hashText = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

// Thrown values are unknown: read only own data properties, never getters or
// coercion hooks. Even descriptor access can throw for a revoked/custom Proxy.
function errorField(error: unknown, key: 'code' | 'message'): unknown {
  if (error === null || typeof error !== 'object') return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

/** 语义检索：整库懒 embed（缺/变更一次批量补算，勿逐条请求——省请求数、避开限流）。 */
async function semanticRetrieve(query: string, deps: RetrievalDeps): Promise<RetrievalResult[]> {
  const { products, repo, embed, signal } = deps
  const model = envStr('AI_EMBEDDING_MODEL')
  signal?.throwIfAborted()
  const queryVectors = await embed([query])
  signal?.throwIfAborted()
  const [qVec] = validateEmbeddingVectors(queryVectors, 1)
  const cachedRows = await repo.allEmbeddings(model)
  signal?.throwIfAborted()
  const cached = new Map(cachedRows.map((r) => [r.productId, r]))
  const missing: { product: Product; hash: string }[] = []
  for (const p of products) {
    const h = hashText(searchableText(p))
    const hit = cached.get(p.id)
    if (!hit || hit.contentHash !== h) missing.push({ product: p, hash: h })
  }
  if (missing.length) {
    // 瞬时限流（429/5xx）：小退避后重试一次；仍失败抛出让上层降级关键词。
    signal?.throwIfAborted()
    const batch = await embed(
      missing.map((m) => searchableText(m.product)),
      qVec.length,
    ).catch(async (e) => {
      signal?.throwIfAborted()
      if (errorField(e, 'code') === 'budget') throw e
      const msg = errorField(e, 'message')
      if (typeof msg === 'string' && /\b(429|5\d\d)\b/.test(msg)) {
        await sleep(1_200, signal)
        signal?.throwIfAborted()
        return embed(
          missing.map((m) => searchableText(m.product)),
          qVec.length,
        )
      }
      throw e
    })
    signal?.throwIfAborted()
    const vecs = validateEmbeddingVectors(batch, missing.length, qVec.length)
    for (let i = 0; i < missing.length; i++) {
      signal?.throwIfAborted()
      await repo.upsertEmbedding({
        productId: missing[i].product.id,
        contentHash: missing[i].hash,
        model,
        vector: vecs[i],
      })
    }
  }
  signal?.throwIfAborted()
  const rows = await repo.allEmbeddings(model)
  signal?.throwIfAborted()
  const byId = new Map(products.map((p) => [p.id, p]))
  return rows
    .map((r) => ({
      handle: byId.get(r.productId)?.handle ?? r.productId,
      score: cosine(qVec, r.vector),
    }))
    .sort((a, b) => b.score - a.score)
}

export async function retrieve(query: string, deps: RetrievalDeps): Promise<RetrievalResult[]> {
  deps.signal?.throwIfAborted()
  const available = await deps.canEmbed()
  deps.signal?.throwIfAborted()
  if (available) {
    try {
      return await semanticRetrieve(query, deps)
    } catch (e) {
      deps.signal?.throwIfAborted()
      // The application budget wrapper uses the stable GuardrailError code
      // without making this search layer depend on the guardrails module.
      // Budget denial must reach chat and stop provider work; only provider
      // or transport failures are eligible for keyword fallback.
      if (errorField(e, 'code') === 'budget') throw e
      // 语义侧故障（限流/过载/瞬时）不拖垮导购：本次请求降级关键词。
      // Exceptions may contain credentials, SQL parameters or upstream bodies.
      // Log only the fallback event, never the thrown value or its message.
      console.warn(JSON.stringify({ event: 'retrieval_fallback', strategy: 'keyword' }))
    }
  }
  deps.signal?.throwIfAborted()
  return keywordSearch(query, deps.products) // 无 embedding 能力 → 关键词降级
}
