import { aiRequestTimeoutMs, envFlag, envStr } from '@/config'
import { validateEmbeddingVectors } from './vector'

let probe: boolean | null = null
// 瞬时限流/过载不算「不可用」：不固化 probe，留待下个请求重探（避免免费额度 429 后
// 整个进程生命周期静默禁用语义检索）。401/400/404 等确定性错误才置 false。
const retryable = (r: Response) => r.status === 429 || r.status >= 500

/** A dispatch guard failure; budget callers must also check their own dispatch state. */
export class EmbeddingDispatchBlockedError extends Error {
  constructor(message = 'Real AI is disabled') {
    super(message)
    this.name = 'EmbeddingDispatchBlockedError'
  }
}

function assertDispatchAllowed(signal?: AbortSignal): void {
  if (envFlag('AI_DISABLE_REAL')) throw new EmbeddingDispatchBlockedError()
  if (signal?.aborted)
    throw new EmbeddingDispatchBlockedError('Embedding cancelled before dispatch')
}

function requestSignal(timeoutMs: number, caller?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs)
  return caller ? AbortSignal.any([deadline, caller]) : deadline
}

function responseVectors(payload: unknown, count: number, expectedDimension?: number): number[][] {
  const invalid = () => new Error('Invalid embedding response')
  if (payload === null || typeof payload !== 'object' || !('data' in payload)) throw invalid()
  const rows: unknown = payload.data
  if (!Array.isArray(rows) || rows.length !== count) throw invalid()
  const vectors: unknown[] = new Array(count)
  const indexed = rows.some((row) => row !== null && typeof row === 'object' && 'index' in row)
  const seen = new Set<number>()
  for (let position = 0; position < rows.length; position++) {
    const row: unknown = rows[position]
    if (row === null || typeof row !== 'object' || !('embedding' in row)) throw invalid()
    let index = position
    if (indexed) {
      if (!('index' in row) || typeof row.index !== 'number' || !Number.isInteger(row.index))
        throw invalid()
      index = row.index
      if (index < 0 || index >= count || seen.has(index)) throw invalid()
      seen.add(index)
    }
    vectors[index] = row.embedding
  }
  return validateEmbeddingVectors(vectors, count, expectedDimension)
}

export type EmbeddingDispatch = { onDispatch?: () => void }
export type EmbeddingProbeRunner = (
  operation: (dispatch?: EmbeddingDispatch) => Promise<Response>,
) => Promise<Response>

// 网关地址与模型名一律**调用时**读取（不做模块级快照）：模块加载时快照会让测试
// vi.stubEnv 失效，也让部署改配置后必须重启进程才生效。
export async function embeddingsAvailable(
  options: { run?: EmbeddingProbeRunner; signal?: AbortSignal } = {},
): Promise<boolean> {
  options.signal?.throwIfAborted()
  // A cached capability must not bypass the operational kill switch. Do not
  // cache this temporary decision, so re-enabling keeps the existing probe state.
  if (envFlag('AI_DISABLE_REAL')) return false
  if (probe !== null) return probe
  const base = envStr('AI_BASE_URL')
  const model = envStr('AI_EMBEDDING_MODEL')
  if (!base || !model) {
    probe = false
    return false
  }
  try {
    const request = async (dispatch?: EmbeddingDispatch) => {
      // Budget admission can await I/O; recheck immediately before dispatch.
      assertDispatchAllowed(options.signal)
      const signal = requestSignal(Math.min(3_000, aiRequestTimeoutMs()), options.signal)
      const init: RequestInit = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${envStr('AI_API_KEY')}`,
        },
        // encoding_format 显式声明 float：OpenAI 官方可省略（默认 float），但 ModelScope
        // api-inference 网关强制要求该字段，缺省即 400；带上它对 OpenAI 官方无害。
        body: JSON.stringify({ model, input: 'ping', encoding_format: 'float' }),
        signal,
      }
      dispatch?.onDispatch?.()
      const response = await fetch(`${base}/embeddings`, init)
      signal.throwIfAborted()
      // Consume under the same deadline before the budget wrapper settles. Probe
      // compatibility remains status-based; formal requests validate vectors.
      await response.arrayBuffer()
      signal.throwIfAborted()
      return response
    }
    const r = await (options.run ? options.run(request) : request())
    options.signal?.throwIfAborted()
    if (r.ok) probe = true
    else if (!retryable(r)) probe = false
  } catch (error) {
    options.signal?.throwIfAborted()
    // A budget wrapper may reject before the probe reaches the network. Do
    // not turn that application decision into a keyword fallback.
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'budget'
    )
      throw error
    // 网络/超时：同样不固化，下次再探
  }
  return probe === true
}

export async function embed(
  texts: string[],
  options: EmbeddingDispatch & { signal?: AbortSignal; expectedDimension?: number } = {},
): Promise<number[][]> {
  assertDispatchAllowed(options.signal)
  const signal = requestSignal(aiRequestTimeoutMs(), options.signal)
  const url = `${envStr('AI_BASE_URL')}/embeddings`
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${envStr('AI_API_KEY')}`,
    },
    body: JSON.stringify({
      model: envStr('AI_EMBEDDING_MODEL'),
      input: texts,
      encoding_format: 'float',
    }),
    signal,
  }
  options.onDispatch?.()
  const res = await fetch(url, init)
  signal.throwIfAborted()
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`embeddings ${res.status}`)
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    signal.throwIfAborted()
    throw new Error('Invalid embedding response')
  }
  signal.throwIfAborted()
  return responseVectors(data, texts.length, options.expectedDimension)
}
