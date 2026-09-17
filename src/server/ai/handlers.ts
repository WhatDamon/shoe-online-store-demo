// 每个 mode 一个处理器：chat() 只管护栏顺序与分发，具体怎么回答在这里。
// 统一签名使每个 mode 可独立单测 —— 注入假的 stream/record 即可，不必穿过护栏栈。
import { createSizeFitEvent, type ChatEvent, type Mode } from '@/domain/chat-events'
import { footMmToEU } from '@/domain/size'
import type { ProductView } from '@/domain/product'
import { getProductForMarket } from '@/server/catalog/service'
import type { AiContext } from './provider'
import { digestLines, productContextOf, toCard } from './context'
import { systemFor } from './prompts'
import { retrieveProducts } from './retrieval-gateway'
import { adviceFor } from './size-input'
import type { ModeHandler, TurnContext } from './turn'

const PRODUCT_REQUIRED_TEXT = 'Pick a product first, then I can help with that.'
/** 消费端文案（导出供测试断言；克制措辞——不出现 "AI"）。 */
export const NO_MATCH_TEXT =
  "I couldn't find a style that matches that yet — try different words or browse the shop."

/** size-fit / outfit 共用的前置：缺 handle 或 handle 查不到都回同一句软拒绝（无 done 帧）。 */
async function* requireProduct(ctx: TurnContext): AsyncGenerator<ChatEvent, ProductView | null> {
  if (!ctx.req.product?.handle) {
    yield { type: 'error', code: 'invalid', message: PRODUCT_REQUIRED_TEXT }
    return null
  }
  const view = await getProductForMarket(ctx.req.product.handle)
  if (!view) {
    yield { type: 'error', code: 'invalid', message: PRODUCT_REQUIRED_TEXT }
    return null
  }
  return view
}

/** size-fit：确定性建议，不调 provider（推荐 / 追问 / 附近无在库）。 */
const handleSizeFit: ModeHandler = async function* (ctx) {
  const view = yield* requireProduct(ctx)
  if (!view) return
  const system = systemFor('size-fit', { product: productContextOf(view) })
  // 「我的尺码」预填（Find my size）：文本无显式尺码且脚长 mm 在表内 → adviceFor 直接采用。
  const known =
    ctx.req.footMm != null && Number.isFinite(ctx.req.footMm) ? footMmToEU(ctx.req.footMm) : null
  const advice = adviceFor(view, ctx.text, known)
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
  const view = yield* requireProduct(ctx)
  if (!view) return
  const system = systemFor('outfit', { product: productContextOf(view) })
  const messages: AiContext['messages'] = [
    ...ctx.history,
    { role: 'user', content: ctx.text || 'Give me outfit ideas.' },
  ]
  const assistant = yield* ctx.stream(system, messages)
  // 记账用实际发给模型的那句：空文本会被替换成默认句。
  await ctx.record(system, messages[messages.length - 1].content, assistant)
  yield { type: 'done' }
}

/** support：店务政策问答（克制客服：只答注入事实，不编造订单/物流能力）。 */
const handleSupport: ModeHandler = async function* (ctx) {
  const system = systemFor('support', {})
  const messages: AiContext['messages'] = [...ctx.history, { role: 'user', content: ctx.text }]
  const assistant = yield* ctx.stream(system, messages)
  await ctx.record(system, ctx.text, assistant)
  yield { type: 'done' }
}

/** find-shoes / shopping：显式检索 → 注入 → 流式。两者只差一件事——find-shoes 先出结果卡。
 * 拆成两个近乎相同的函数只会得到一层透传，故共用并按 req.mode 分叉。 */
const handleCatalogModes: ModeHandler = async function* (ctx) {
  const { req, text } = ctx
  const products = await retrieveProducts(text)
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
    yield { type: 'delta', text: NO_MATCH_TEXT }
    await ctx.record(systemFor(req.mode, {}), text, NO_MATCH_TEXT)
    yield { type: 'done' }
    return
  }
  const system = systemFor(req.mode, { catalogDigest: digest, product: productCtx })
  const messages: AiContext['messages'] = [...ctx.history, { role: 'user', content: text }]
  if (req.mode === 'find-shoes') {
    yield { type: 'productCards', items: products.map(toCard) }
  }
  const assistant = yield* ctx.stream(system, messages)
  await ctx.record(system, text, assistant)
  yield { type: 'done' }
}

export const modeHandlers: Record<Mode, ModeHandler> = {
  shopping: handleCatalogModes,
  'find-shoes': handleCatalogModes,
  outfit: handleOutfit,
  'size-fit': handleSizeFit,
  support: handleSupport,
}
