// chat() 编排（规格 §8：护栏 → 模式分发 → 检索/上下文 → 流 → 事件行）。
// RAG-lite 零工具调用：检索命中经 digest/system 注入，模型只能基于注入内容作答（§8.2/§8.5.4）。
// 会话回合计数 + 历史裁剪由护栏实例持有；生产用模块级共享单例，测试注入内存库实例。
import { createGuardrails, type Guardrails } from '@/server/guardrails'
import { GuardrailError } from '@/server/guardrails'
import type { SessionMessage } from '@/server/guardrails/session-state'
import { MAX_OUTPUT_TOKENS, estTokens, truncateMessage } from '@/server/guardrails/text'
import { today } from '@/server/guardrails/budget'
import { catalog } from '@/server/catalog/adapter'
import { convert } from '@/server/catalog/size-charts'
import type { CanonicalSize, Product } from '@/server/catalog/types'
import { getProductForMarket } from '@/server/catalog/service'
import { market } from '@/lib/market'
import { footMmToEU } from '@/lib/my-size'
import { retrieve } from '@/server/search/retrieval'
import { createDefaultRepository } from '@/server/search/repository'
import { createSizeFitEvent } from './events'
import type { AiContext, AiProvider } from './provider'
import type { ChatEvent, Mode, ProductCard } from './events'
import { aiProvider, aiModel } from './provider'
import { systemFor } from './prompts'
import { adviceFor } from './size-input'

// 商品卡/码段展示口径（决策 #20）：与 PDP 描述/Select size chips 同源——canonical(EU) 经
// 市场换算表显示为市场系统区间（默认 US），绝不裸写 EU 数字（同号易与中国码混读）。
// 市场大小写标签取市场系统名（US/EU/UK/JP/CN）。
function sizeRangeText(sizes: number[]): string | null {
  const lo = convert(Math.min(...sizes) as CanonicalSize, market.sizeSystem)
  const hi = convert(Math.max(...sizes) as CanonicalSize, market.sizeSystem)
  if (lo == null || hi == null) return null
  return `${market.sizeSystem} ${lo}–${hi}`
}

export interface ChatRequest {
  sessionKey: string
  ip: string
  mode: Mode
  product?: { handle: string; title: string } | null
  text: string
  /** 「我的尺码」脚长 mm（可选预填）：size-fit 且文本无显式尺码时回退用之。 */
  footMm?: number | null
}

export interface ChatOptions {
  /** 测试注入：内存库护栏实例；生产省略 → 模块级共享单例（跨请求计数才有意义）。 */
  guardrails?: Guardrails
  /** 测试注入：固定 provider；默认按 env 工厂选 Mock/真实。 */
  provider?: AiProvider
}

const PRODUCT_REQUIRED_TEXT = 'Pick a product first, then I can help with that.'
const FALLBACK_ERROR_TEXT = 'Something went wrong — please try again.'
/** 消费端文案（导出供测试断言；克制措辞——不出现 "AI"）。 */
export const NO_MATCH_TEXT =
  "I couldn't find a style that matches that yet — try different words or browse the shop."

let shared: Guardrails | null = null
const sharedGuardrails = (): Guardrails => (shared ??= createGuardrails(createDefaultRepository()))

/** GuardrailError → 对应 code + 温和文案（code 1:1 透传，含 'turns'）；其余 → provider 错误。 */
const toErrorEvent = (e: unknown): ChatEvent => {
  if (e instanceof GuardrailError) return { type: 'error', code: e.code, message: e.message }
  return { type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }
}

// 商品结果卡：真实首图 + 真实元数据（码段/色卡数/照片数），不带价格（价格只在
// 详情页与店铺；AI 不传播 demo 价段）。images 为空的产品（目前目录无此情形）→
// imageKind 'svg'，由 UI 以 ProductVisual 色卡视觉兜底。
const toCard = (p: Product): ProductCard => ({
  handle: p.handle,
  title: p.title,
  subtitle: p.subtitle,
  image: p.images?.[0] ?? null,
  imageKind: (p.images?.length ?? 0) > 0 ? 'photo' : 'svg',
  photoCount: p.images?.length ?? 0,
  sizeRange: p.sizes.length ? sizeRangeText(p.sizes) : null,
  colorCount: p.colors?.length ?? 0,
  palette: p.visual.palette,
})

// digest 注入真实字段（标题/品类/描述），绝不携带价格（价格非原始数据，勿向模型传播）。
const digestLines = (ps: Product[]): string =>
  ps.map((p) => `- ${p.title} (${p.productType}): ${p.description}`).join('\n')

/** 检索 top-N 并取回完整商品。注意 retrieve 默认参陷阱：省略第二参（勿传 {}，会关掉语义嵌入）。 */
async function retrieveProducts(query: string, limit = 4): Promise<Product[]> {
  const hits = await retrieve(query)
  // 相关性下限：语义路径对全目录做余弦后按分排序、不过滤，余弦≈0/负分的无关行会占满 top-N，
  // 使 NO_MATCH 分支不可达。此处消费侧过滤（检索契约不变），阈值取 >0（嵌入尺度随模型而异，
  // 保守下限只剔除正交/负分噪声；更严格截断待引入原生向量后端时按已知模型标定）。
  const relevant = hits.filter((h) => h.score > 0)
  const ps = await Promise.all(
    relevant.slice(0, limit).map((h) => catalog.getProductByHandle(h.handle)),
  )
  return ps.filter((p): p is Product => p !== null)
}

const productContextOf = (v: Product): string =>
  `Product: ${v.title}. ${v.description} Upper palette: ${v.visual.palette[0]} and ${v.visual.palette[1]}; accent: ${v.visual.accent}.`

/** 护栏顺序：rate → budget → turns；被 rate/budget 拒的请求不消耗回合（回合 claim 最后执行）。 */
export async function* chat(req: ChatRequest, opts: ChatOptions = {}): AsyncGenerator<ChatEvent> {
  const guardrails = opts.guardrails ?? sharedGuardrails()
  const provider = opts.provider ?? aiProvider()
  const text = truncateMessage(req.text ?? '')
  // 记账模型与实际选中的 provider 同源（修复：勿用 AI_MODEL ?? 'mock'，会把真实调用记成 mock）。
  const model = aiModel()

  try {
    guardrails.assertRate(req.ip, req.sessionKey)
  } catch (e) {
    yield toErrorEvent(e)
    return
  }
  try {
    await guardrails.assertBudget()
  } catch (e) {
    yield toErrorEvent(e)
    return
  }
  let history: SessionMessage[]
  try {
    history = guardrails.assertTurn(req.sessionKey)
  } catch (e) {
    yield toErrorEvent(e)
    return
  }

  // 护栏全过，回合已领取（claim 在 provider 调用前；失败/中止的请求同样计入一次尝试——注释见 guardrails）。
  const record = async (system: string, userText: string, assistantText: string): Promise<void> => {
    guardrails.pushTurn(req.sessionKey, 'user', userText)
    guardrails.pushTurn(req.sessionKey, 'assistant', assistantText)
    const prompt = [system, ...history.map((m) => m.content), userText].filter(Boolean).join('\n')
    try {
      await guardrails.noteUsage({
        day: today(),
        model,
        promptTokens: estTokens(prompt),
        completionTokens: estTokens(assistantText),
        sessionKey: req.sessionKey,
      })
    } catch (err) {
      // 用量记账失败不打断用户回复（仅影响成本审计，属于内部路径）。
      console.error('[chat] noteUsage failed', err)
    }
  }

  try {
    // ---- size-fit：确定性建议（不调 provider；推荐/追问/无货三分支）----
    if (req.mode === 'size-fit') {
      if (!req.product?.handle) {
        yield { type: 'error', code: 'invalid', message: PRODUCT_REQUIRED_TEXT }
        return
      }
      const view = await getProductForMarket(req.product.handle)
      if (!view) {
        yield { type: 'error', code: 'invalid', message: PRODUCT_REQUIRED_TEXT }
        return
      }
      const system = systemFor('size-fit', { product: productContextOf(view) })
      // 「我的尺码」预填（Find my size）：文本无显式尺码且脚长 mm 在表内 → adviceFor 直接采用。
      const known =
        req.footMm != null && Number.isFinite(req.footMm) ? footMmToEU(req.footMm) : null
      const advice = adviceFor(view, text, null, known)
      if (advice.askedForInput || advice.recommended === null) {
        // 追问问题 / 附近无在库——都只回文本
        yield { type: 'delta', text: advice.rationale }
        await record(system, text, advice.rationale)
      } else {
        const sizeFit = createSizeFitEvent({
          recommended: advice.recommended,
          alternatives: advice.alternatives,
          rationale: advice.rationale,
        })
        yield sizeFit
        yield { type: 'delta', text: advice.rationale }
        await record(system, text, advice.rationale)
      }
      yield { type: 'done' }
      return
    }

    // ---- outfit：以当前商品为主角的搭配建议（流式；mock = 固定 3 条）----
    if (req.mode === 'outfit') {
      if (!req.product?.handle) {
        yield { type: 'error', code: 'invalid', message: PRODUCT_REQUIRED_TEXT }
        return
      }
      const view = await getProductForMarket(req.product.handle)
      if (!view) {
        yield { type: 'error', code: 'invalid', message: PRODUCT_REQUIRED_TEXT }
        return
      }
      const system = systemFor('outfit', { product: productContextOf(view) })
      const messages: AiContext['messages'] = [
        ...history,
        { role: 'user', content: text || 'Give me outfit ideas.' },
      ]
      let assistant = ''
      for await (const delta of provider.stream({
        system,
        maxTokens: MAX_OUTPUT_TOKENS,
        messages,
      })) {
        assistant += delta
        yield { type: 'delta', text: delta }
      }
      await record(system, messages[messages.length - 1].content, assistant)
      yield { type: 'done' }
      return
    }

    // ---- support：店务政策问答（克制客服，规格：只答注入事实，不编造订单/物流能力）----
    if (req.mode === 'support') {
      const system = systemFor('support', {})
      const messages: AiContext['messages'] = [...history, { role: 'user', content: text }]
      let assistant = ''
      for await (const delta of provider.stream({
        system,
        maxTokens: MAX_OUTPUT_TOKENS,
        messages,
      })) {
        assistant += delta
        yield { type: 'delta', text: delta }
      }
      await record(system, text, assistant)
      yield { type: 'done' }
      return
    }

    // ---- find-shoes / shopping：显式检索 → 注入 → 流式 ----
    const products = await retrieveProducts(text)
    if (products.length === 0) {
      yield { type: 'delta', text: NO_MATCH_TEXT }
      await record(systemFor(req.mode, {}), text, NO_MATCH_TEXT)
      yield { type: 'done' }
      return
    }
    const digest = digestLines(products)
    const system = systemFor(req.mode, { catalogDigest: digest })
    const messages: AiContext['messages'] = [...history, { role: 'user', content: text }]
    if (req.mode === 'find-shoes') {
      yield { type: 'productCards', items: products.map(toCard) }
    }
    let assistant = ''
    for await (const delta of provider.stream({
      system,
      maxTokens: MAX_OUTPUT_TOKENS,
      messages,
    })) {
      assistant += delta
      yield { type: 'delta', text: delta }
    }
    await record(system, text, assistant)
    yield { type: 'done' }
  } catch (e) {
    // provider 运行期失败 → 显式 error + UI 重试（P3：绝不静默降级到 Mock）
    yield toErrorEvent(e)
  }
}
