// size-fit 确定性建议核心：复用 size-charts 的 parseSizeHint/nearestCanonical，不做 LLM 解析
// （确定性、可测、零成本）。
import { parseSizeHint, nearestCanonical } from '@/domain/size'
import type { CanonicalSize, ProductView } from '@/domain/product'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

export interface SizeAdvice {
  recommended: CanonicalSize | null
  alternatives: CanonicalSize[]
  rationale: string
  /** true = 信息不足需追问（此时 recommended=null） */
  askedForInput: boolean
}

/**
 * 条目文案按**请求语言**取用（`locale` 由入口 `/api/ai/chat` 经 `isLocale` 校验后一路传下来）。
 * 默认值只服务于「直接构造的调用点」——测试与既有单测，与 `systemFor` 的口径一致。
 */
export function adviceFor(
  product: ProductView,
  userText: string,
  /** 「我的尺码」已知 canonical（脚长 mm 映射）：文本无码时回退用之 */
  known?: CanonicalSize | null,
  /** 请求语言：只决定文案，不改变尺码体系与换算（ADR 0008 决策 6） */
  locale: Locale = DEFAULT_LOCALE,
): SizeAdvice {
  const t = messages(locale)
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
