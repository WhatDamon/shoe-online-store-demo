// size-fit 确定性建议核心：复用 size-charts 的 parseSizeHint/nearestCanonical，不做 LLM 解析
// （确定性、可测、零成本）。
import { parseSizeHint, nearestCanonical } from '@/domain/size'
import type { CanonicalSize, ProductView } from '@/domain/product'

export interface SizeAdvice {
  recommended: CanonicalSize | null
  alternatives: CanonicalSize[]
  rationale: string
  /** true = 信息不足需追问（此时 recommended=null） */
  askedForInput: boolean
}

export function adviceFor(
  product: ProductView,
  userText: string,
  /** 「我的尺码」已知 canonical（脚长 mm 映射）：文本无码时回退用之 */
  known?: CanonicalSize | null,
): SizeAdvice {
  // 显式回答（文本含尺码）优先；未答但已知「我的尺码」时直接采用（Find my size 预填）。
  const wanted = parseSizeHint(userText) ?? known ?? null
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
