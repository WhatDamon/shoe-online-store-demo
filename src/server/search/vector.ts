export const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
export function cosine(a: number[], b: number[]): number {
  const mag = magnitude(a) * magnitude(b)
  if (mag === 0) return 0
  return a.reduce((s, x, i) => s + x * b[i], 0) / mag
}
