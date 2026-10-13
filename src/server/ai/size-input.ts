// size-fit 确定性建议核心：复用 size-charts 的 parseSizeHint/nearestCanonical，不做 LLM 解析
// （确定性、可测、零成本）。
import { parseSizeHint, nearestCanonical } from '@/domain/size'
import type { CanonicalSize, ProductView } from '@/domain/product'
import { DEFAULT_LOCALE } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

// 消费端文案取自词典。阶段 1 只有一种语言，故取默认语言；**阶段 2 必须把请求 locale 接进来**
// （`/api/ai/chat` 请求体经 `isLocale` 校验后转交，见规格 §9「AI 回答语言」；那时
// `adviceFor` 需要多一个 locale 参数）。
const t = messages(DEFAULT_LOCALE)

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
      rationale: t['assistant.sizeFit.askForSize'],
      askedForInput: true,
    }
  }
  const recommended = nearestCanonical(wanted, product.sizes)
  if (recommended === null)
    return {
      recommended: null,
      alternatives: [],
      rationale: t['assistant.sizeFit.outOfStock'],
      askedForInput: false,
    }
  const alternatives = product.sizes.filter((s) => s !== recommended)
  return {
    recommended,
    alternatives,
    // `(EU)` 是尺码体系名（领域事实，ADR 0008 决策 6：语言不改变尺码显示体系）。
    rationale: `${product.title} ${t['assistant.sizeFit.runs']} ${product.fitNotes} ${t['assistant.sizeFit.basedOnUsualSize']} ${recommended} (EU) ${t['assistant.sizeFit.shouldFitBest']}`,
    askedForInput: false,
  }
}
