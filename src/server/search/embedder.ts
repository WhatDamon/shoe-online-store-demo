const base = process.env.AI_BASE_URL ?? ''
const model = process.env.AI_EMBEDDING_MODEL ?? ''
let probe: boolean | null = null
// 瞬时限流/过载不算「不可用」：不固化 probe，留待下个请求重探（避免免费额度 429 后
// 整个进程生命周期静默禁用语义检索）。401/400/404 等确定性错误才置 false。
const retryable = (r: Response) => r.status === 429 || r.status >= 500
export async function embeddingsAvailable(): Promise<boolean> {
  if (probe !== null) return probe
  if (!base || !model) {
    probe = false
    return false
  }
  try {
    const r = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      // encoding_format 显式声明 float：OpenAI 官方可省略（默认 float），但 ModelScope
      // api-inference 网关强制要求该字段，缺省即 400；带上它对 OpenAI 官方无害。
      body: JSON.stringify({ model, input: 'ping', encoding_format: 'float' }),
      signal: AbortSignal.timeout(3_000),
    })
    if (r.ok) probe = true
    else if (!retryable(r)) probe = false
  } catch {
    // 网络/超时：同样不固化，下次再探
  }
  return probe === true
}

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
  })
  if (!res.ok) throw new Error(`embeddings ${res.status}`)
  const data = (await res.json()) as { data: { embedding: number[] }[] }
  return data.data.map((d) => d.embedding)
}
