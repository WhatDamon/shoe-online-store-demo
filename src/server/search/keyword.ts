import type { Product } from '@/server/catalog/types'

// 与 retrieval.ts 的 textualContent 同实现——两个文件各自持有副本，
// 避免 keyword ⇄ retrieval 的循环依赖（retrieval 依赖 keywordSearch）。
const textualContent = (p: Product) =>
  [p.title, p.subtitle, p.productType, ...p.tags, ...p.features, p.description].join(' ').toLowerCase()

// title 命中的位置权重（规格 §8.3.4：title 命中权重高）
const TITLE_WEIGHT = 3

const countHits = (haystack: string, token: string): number => {
  let n = 0
  let i = haystack.indexOf(token)
  while (i !== -1) {
    n++
    i = haystack.indexOf(token, i + token.length)
  }
  return n
}

// 对候选 Product 打分：token 命中次数 × 位置权重（title 命中权重高）；降序返回。
export function keywordSearch(query: string, products: Product[]): { handle: string; score: number }[] {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g)
  if (!tokens || tokens.length === 0) return []
  const scored: { handle: string; score: number }[] = []
  for (const p of products) {
    const content = textualContent(p)
    const title = p.title.toLowerCase()
    let score = 0
    for (const t of tokens) {
      const hits = countHits(content, t)
      if (hits === 0) continue
      score += hits * (title.includes(t) ? TITLE_WEIGHT : 1)
    }
    if (score > 0) scored.push({ handle: p.handle, score })
  }
  return scored.sort((a, b) => b.score - a.score)
}
