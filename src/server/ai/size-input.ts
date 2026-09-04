// size-fit 确定性建议核心（规格 §8.2：附尺码表 + fitNotes，引导式 → 推荐 + 解释）。
// 复用 size-charts 的 parseSizeHint/nearestCanonical，不做 LLM 解析（确定性、可测、零成本）。
import { parseSizeHint, nearestCanonical } from '@/server/catalog/size-charts'
import type { ProductView } from '@/server/catalog/service'

export interface SizeAdvice {
  recommended: number | null // canonical EU
  alternatives: number[]
  rationale: string
  askedForInput: boolean // true = 信息不足需追问（此时 recommended=null）
}

export function adviceFor(
  product: ProductView,
  userText: string,
  base?: SizeAdvice | null, // 预留：多轮追问时携带上一轮建议作上下文；本版流程单轮确定，不使用
): SizeAdvice {
  void base
  const wanted = parseSizeHint(userText)
  if (!wanted) {
    return {
      recommended: null,
      alternatives: [],
      rationale: 'Can you tell me the size you usually wear, or your foot length in cm?',
      askedForInput: true,
    }
  }
  const recommended = nearestCanonical(wanted, product.sizes)
  if (recommended === null)
    return {
      recommended: null,
      alternatives: [],
      rationale: 'This style is currently out of stock in nearby sizes.',
      askedForInput: false,
    }
  const alternatives = product.sizes.filter((s) => s !== recommended)
  return {
    recommended,
    alternatives,
    rationale: `${product.title} runs ${product.fitNotes} Based on your usual size, ${recommended} (EU) should fit best.`,
    askedForInput: false,
  }
}
