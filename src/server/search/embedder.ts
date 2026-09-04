const base = process.env.AI_BASE_URL ?? ''
const model = process.env.AI_EMBEDDING_MODEL ?? ''
let probe: boolean | null = null
export async function embeddingsAvailable(): Promise<boolean> {
  if (probe !== null) return probe
  if (!base || !model) {
    probe = false
    return false
  }
  probe = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ model, input: 'ping' }),
    signal: AbortSignal.timeout(3_000),
  })
    .then((r) => r.ok)
    .catch(() => false)
  return probe
}

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ model, input: texts }),
  })
  if (!res.ok) throw new Error(`embeddings ${res.status}`)
  const data = (await res.json()) as { data: { embedding: number[] }[] }
  return data.data.map((d) => d.embedding)
}
