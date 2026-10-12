/** Validate the complete batch before any caller writes or scores its vectors. */
export function validateEmbeddingVectors(
  value: unknown,
  count: number,
  expectedDimension?: number,
): number[][] {
  const invalid = () => new Error('Invalid embedding response')
  if (!Array.isArray(value) || value.length !== count) throw invalid()
  let dimension = expectedDimension
  for (const vector of value) {
    if (!Array.isArray(vector) || vector.length === 0) throw invalid()
    dimension ??= vector.length
    if (vector.length !== dimension) throw invalid()
    let normSquared = 0
    for (const component of vector) {
      if (typeof component !== 'number' || !Number.isFinite(component)) throw invalid()
      normSquared += component * component
    }
    if (!Number.isFinite(normSquared) || normSquared === 0) throw invalid()
  }
  return value
}

const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))

/** 余弦相似度。维度不一致（如换 embedding 模型后旧行残留）或零向量都按不命中处理。 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  const mag = magnitude(a) * magnitude(b)
  if (mag === 0) return 0
  return a.reduce((s, x, i) => s + x * b[i], 0) / mag
}

/** 解析 DB 里的 JSON 向量；损坏/非数值行返回 []（余弦得 0 → 该商品不命中，不炸会话）。 */
export function parseVector(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      : []
  } catch {
    return []
  }
}
