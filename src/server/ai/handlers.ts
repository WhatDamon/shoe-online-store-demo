// 每个 mode 一个处理器：chat() 只管护栏顺序与分发，具体怎么回答在这里。
// 统一签名使每个 mode 可独立单测 —— 注入假的 stream/record 即可，不必穿过护栏栈。
import { createSizeFitEvent, type ChatEvent, type Mode } from '@/domain/chat-events'
import { footMmToEU } from '@/domain/size'
import type { ProductView } from '@/domain/product'
import { getProductForMarket } from '@/server/catalog/service'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'
import type { AiContext } from './provider'
import { digestLines, productContextOf, toCard } from './context'
import { systemFor } from './prompts'
import { adviceFor } from './size-input'
import type { ModeHandler, TurnContext } from './turn'

// 消费端文案按**请求语言**取用：locale 由入口 `/api/ai/chat` 经 `isLocale` 校验后放进 `req`
// （`ChatRequest.locale`），handler 从 `ctx.req` 取——不再持有默认语言的模块级快照。
const productRequiredText = (locale: Locale): string =>
  messages(locale)['assistant.productRequired']
const noMatchText = (locale: Locale): string => messages(locale)['assistant.noMatch']

/** 无匹配文案（导出供测试断言；克制措辞——不出现 "AI"）：既有测试钉住的 `export const`，
 * 值 = 默认语言，形态不得改成函数。 */
export const NO_MATCH_TEXT = noMatchText(DEFAULT_LOCALE)

/** size-fit / outfit 共用的前置：缺 handle 或 handle 查不到都回同一句软拒绝（无 done 帧）。 */
async function* requireProduct(ctx: TurnContext): AsyncGenerator<ChatEvent, ProductView | null> {
  if (!ctx.req.product?.handle) {
    yield { type: 'error', code: 'invalid', message: productRequiredText(ctx.req.locale) }
    return null
  }
  const view = await getProductForMarket(ctx.req.product.handle)
  if (!view) {
    yield { type: 'error', code: 'invalid', message: productRequiredText(ctx.req.locale) }
    return null
  }
  return view
}

/** size-fit：确定性建议，不调 provider（推荐 / 追问 / 附近无在库）。 */
const handleSizeFit: ModeHandler = async function* (ctx) {
  const locale = ctx.req.locale
  const view = yield* requireProduct(ctx)
  if (!view) return
  const system = systemFor('size-fit', { product: productContextOf(view) }, locale)
  // 「我的尺码」预填（Find my size）：文本无显式尺码且脚长 mm 在表内 → adviceFor 直接采用。
  const known =
    ctx.req.footMm != null && Number.isFinite(ctx.req.footMm) ? footMmToEU(ctx.req.footMm) : null
  const advice = adviceFor(view, ctx.text, known, locale)
  // 追问问题 / 附近无在库 —— 都只回文本，不出 sizeFit 事件。
  if (!advice.askedForInput && advice.recommended !== null) {
    yield createSizeFitEvent({
      recommended: advice.recommended,
      alternatives: advice.alternatives,
      rationale: advice.rationale,
    })
  }
  yield { type: 'delta', text: advice.rationale }
  await ctx.record(system, ctx.text, advice.rationale)
  yield { type: 'done' }
}

/** outfit：以当前商品为主角的搭配建议（流式；mock = 固定 3 条）。 */
const handleOutfit: ModeHandler = async function* (ctx) {
  const locale = ctx.req.locale
  const view = yield* requireProduct(ctx)
  if (!view) return
  const system = systemFor('outfit', { product: productContextOf(view) }, locale)
  // 局部变量不再叫 `messages`：那会遮蔽字典访问器，而空文本分支正要读词典。
  const conversation: AiContext['messages'] = [
    ...ctx.history,
    { role: 'user', content: ctx.text || messages(locale)['assistant.outfitPrompt'] },
  ]
  const reply = yield* ctx.stream(system, conversation)
  // 记账用实际发给模型的那句：空文本会被替换成默认句。
  await ctx.record(system, conversation[conversation.length - 1].content, reply.text, reply.usage)
  yield { type: 'done' }
}

/** support：店务政策问答（克制客服：只答注入事实，不编造订单/物流能力）。 */
const handleSupport: ModeHandler = async function* (ctx) {
  const system = systemFor('support', {}, ctx.req.locale)
  const messages: AiContext['messages'] = [...ctx.history, { role: 'user', content: ctx.text }]
  const reply = yield* ctx.stream(system, messages)
  await ctx.record(system, ctx.text, reply.text, reply.usage)
  yield { type: 'done' }
}

/** find-shoes / shopping：显式检索 → 注入 → 流式。两者只差一件事——find-shoes 先出结果卡。
 * 拆成两个近乎相同的函数只会得到一层透传，故共用并按 req.mode 分叉。 */
const handleCatalogModes: ModeHandler = async function* (ctx) {
  const { req, text } = ctx
  const locale = req.locale
  const products = await ctx.retrieveProducts(text)
  const digest = digestLines(products)
  // PDP 锚定（设计：FAB 打开带上当前鞋，shopping 自由提问也能针对该鞋回答）：
  // handle 可查 → 注入该鞋真实事实块（同 size-fit/outfit）；无效/未知 → 静默回退纯 digest
  // （shopping 无强商品依赖，不报错）。
  let productCtx: string | undefined
  if (req.mode === 'shopping' && req.product?.handle) {
    const anchored = await getProductForMarket(req.product.handle)
    if (anchored) productCtx = productContextOf(anchored)
  }
  if (products.length === 0 && !productCtx) {
    const noMatch = noMatchText(locale)
    yield { type: 'delta', text: noMatch }
    await ctx.record(systemFor(req.mode, {}, locale), text, noMatch)
    yield { type: 'done' }
    return
  }
  const system = systemFor(req.mode, { catalogDigest: digest, product: productCtx }, locale)
  const conversation: AiContext['messages'] = [...ctx.history, { role: 'user', content: text }]
  if (req.mode === 'find-shoes') {
    yield { type: 'productCards', items: products.map(toCard) }
  }
  const reply = yield* ctx.stream(system, conversation)
  await ctx.record(system, text, reply.text, reply.usage)
  yield { type: 'done' }
}

export const modeHandlers: Record<Mode, ModeHandler> = {
  shopping: handleCatalogModes,
  'find-shoes': handleCatalogModes,
  outfit: handleOutfit,
  'size-fit': handleSizeFit,
  support: handleSupport,
}
