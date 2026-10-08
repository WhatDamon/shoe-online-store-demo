import { envFlag, envStr } from '@/config'

let probe: boolean | null = null
// 瞬时限流/过载不算「不可用」：不固化 probe，留待下个请求重探（避免免费额度 429 后
// 整个进程生命周期静默禁用语义检索）。401/400/404 等确定性错误才置 false。
const retryable = (r: Response) => r.status === 429 || r.status >= 500

/** Only thrown before fetch; callers can safely release an unused reservation. */
export class EmbeddingDispatchBlockedError extends Error {
  constructor() {
    super('Real AI is disabled')
    this.name = 'EmbeddingDispatchBlockedError'
  }
}

function assertRealAiEnabled(): void {
  if (envFlag('AI_DISABLE_REAL')) throw new EmbeddingDispatchBlockedError()
}

export type EmbeddingProbeRunner = (operation: () => Promise<Response>) => Promise<Response>

// 网关地址与模型名一律**调用时**读取（不做模块级快照）：模块加载时快照会让测试
// vi.stubEnv 失效，也让部署改配置后必须重启进程才生效。
export async function embeddingsAvailable(
  options: { run?: EmbeddingProbeRunner } = {},
): Promise<boolean> {
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
    const request = () => {
      // Budget admission can await I/O; recheck immediately before dispatch.
      assertRealAiEnabled()
      return fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${envStr('AI_API_KEY')}`,
        },
        // encoding_format 显式声明 float：OpenAI 官方可省略（默认 float），但 ModelScope
        // api-inference 网关强制要求该字段，缺省即 400；带上它对 OpenAI 官方无害。
        body: JSON.stringify({ model, input: 'ping', encoding_format: 'float' }),
        signal: AbortSignal.timeout(3_000),
      })
    }
    const r = await (options.run ? options.run(request) : request())
    if (r.ok) probe = true
    else if (!retryable(r)) probe = false
  } catch (error) {
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

export async function embed(texts: string[]): Promise<number[][]> {
  assertRealAiEnabled()
  const res = await fetch(`${envStr('AI_BASE_URL')}/embeddings`, {
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
  })
  if (!res.ok) throw new Error(`embeddings ${res.status}`)
  const data = (await res.json()) as { data: { embedding: number[] }[] }
  return data.data.map((d) => d.embedding)
}
