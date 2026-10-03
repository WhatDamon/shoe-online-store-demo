// chat() 编排（护栏 → 模式分发 → 检索/上下文 → 流 → 事件行）。
// RAG-lite 零工具调用：检索命中经 digest/system 注入，模型只能基于注入内容作答（§8.2/§8.5.4）。
// 本文件只管护栏顺序、上下文装配与错误映射；每个 mode 具体怎么回答见 handlers.ts。
import { createGuardrails, GuardrailError, type Guardrails } from '@/server/guardrails'
import type { SessionMessage } from '@/server/guardrails/session-state'
import { estTokens, maxOutputTokens, truncateMessage } from '@/server/guardrails/text'
import { today } from '@/server/guardrails/budget'
import { envStr } from '@/config'
import { createDefaultRepository } from '@/server/search/repository'
import type { ChatEvent } from '@/domain/chat-events'
import type { AiContext, AiProvider, AiUsage } from './provider'
import { aiModel, aiProvider } from './factory'
import { modeHandlers } from './handlers'
import {
  retrieveProducts as retrieveCatalogProducts,
  type EmbeddingRunner,
} from './retrieval-gateway'
import type { ChatRequest, ProviderReply, TurnContext } from './turn'

export type { ChatRequest } from './turn'

export interface ChatOptions {
  /** 测试注入：内存库护栏实例；生产省略 → 模块级共享单例（跨请求计数才有意义）。 */
  guardrails?: Guardrails
  /** 测试注入：固定 provider；默认按 env 工厂选 Mock/真实。 */
  provider?: AiProvider
  signal?: AbortSignal
  /** Server-owned correlation ID; never derived from session or user input. */
  requestId?: string
}

/** 流内异常的统一文案；`/api/ai/chat` 的兜底 catch 也用它（单一来源）。 */
export const FALLBACK_ERROR_TEXT = 'Something went wrong — please try again.'

const validUsage = (usage: AiUsage | undefined): AiUsage | undefined =>
  usage &&
  Number.isSafeInteger(usage.promptTokens) &&
  usage.promptTokens >= 0 &&
  Number.isSafeInteger(usage.completionTokens) &&
  usage.completionTokens >= 0
    ? usage
    : undefined

let shared: Guardrails | null = null
const sharedGuardrails = (): Guardrails => (shared ??= createGuardrails(createDefaultRepository()))

/** GuardrailError → 对应 code + 温和文案（code 1:1 透传，含 'turns'）；其余 → provider 错误。 */
const logAi = (
  level: 'warn' | 'error',
  event: string,
  fields: Record<string, string | number>,
): void => {
  console[level](JSON.stringify({ event, ...fields }))
}

const toErrorEvent = (e: unknown, requestId: string, elapsedMs: number): ChatEvent => {
  if (e instanceof GuardrailError) {
    // 护栏拒绝（rate_limited/budget/turns）是设计内软拒绝：仅记录 code（不携带会话/内容/访客信息），
    // 便于 Vercel 端区分「配置误伤（如空 env 把预算打成 0）」与真实滥用；UI 仍只显示温和文案。
    logAi('warn', 'ai_guardrail_refusal', {
      request_id: requestId,
      code: e.code,
      elapsed_ms: elapsedMs,
    })
    return { type: 'error', code: e.code, message: e.message }
  }
  // Provider/database exceptions can include credentials, URLs or request bodies.
  logAi('error', 'ai_provider_failure', { request_id: requestId, elapsed_ms: elapsedMs })
  return { type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }
}

/** 护栏顺序：rate → budget → turns；被 rate/budget 拒的请求不消耗回合（回合 claim 最后执行）。
 * 三者任一失败都只回一个 error 帧，故合并为一个 try —— 原先是三个逐字相同的 try/catch。 */
export async function* chat(req: ChatRequest, opts: ChatOptions = {}): AsyncGenerator<ChatEvent> {
  const traceId = opts.requestId ?? crypto.randomUUID()
  const startedAt = Date.now()
  const elapsed = () => Math.max(0, Date.now() - startedAt)
  const guardrails = opts.guardrails ?? sharedGuardrails()
  const provider = opts.provider ?? aiProvider()
  const text = truncateMessage(req.text ?? '')
  // 记账模型与实际选中的 provider 同源（修复：勿用 AI_MODEL ?? 'mock'，会把真实调用记成 mock）。
  const model = aiModel()
  const budgetDay = today()

  let history: SessionMessage[]
  try {
    opts.signal?.throwIfAborted()
    guardrails.assertRate(req.ip, req.sessionKey)
    // Fast-fail an already exhausted day. The authoritative decision is the
    // atomic reservation immediately before provider work below.
    await guardrails.assertBudget(budgetDay)
    history = guardrails.assertTurn(req.sessionKey)
  } catch (e) {
    yield toErrorEvent(e, traceId, elapsed())
    return
  }

  const budgetRequestId = crypto.randomUUID()
  let activeReservation = false
  let providerStarted = false

  /**
   * Retrieval can make more than one embedding request (probe, query, and a
   * missing-product batch). Each network call gets its own reservation so it
   * cannot spend the chat provider's reservation or bypass the daily cap.
   */
  const runEmbedding: EmbeddingRunner = async (texts, operation) => {
    const tokens = Math.max(
      1,
      texts.reduce((total, value) => total + estTokens(value), 0),
    )
    const embeddingRequestId = crypto.randomUUID()
    const embeddingModel = envStr('AI_EMBEDDING_MODEL', 'embedding')
    await guardrails.reserveBudget(embeddingRequestId, tokens, budgetDay)
    try {
      const result = await operation()
      if (result instanceof Response && !result.ok) {
        await guardrails.abandonBudget(embeddingRequestId)
      } else {
        await guardrails.settleBudget(embeddingRequestId, {
          day: budgetDay,
          model: embeddingModel,
          promptTokens: tokens,
          completionTokens: 0,
          sessionKey: req.sessionKey,
        })
      }
      return result
    } catch (error) {
      try {
        await guardrails.abandonBudget(embeddingRequestId)
      } catch {
        logAi('error', 'ai_budget_finalization_failed', {
          request_id: traceId,
          phase: 'embedding',
          elapsed_ms: elapsed(),
        })
      }
      throw error
    }
  }

  const retrieveForChat = (query: string, limit?: number) =>
    retrieveCatalogProducts(query, limit, { runEmbedding })

  const reserveFor = async (system: string, messages: AiContext['messages']) => {
    const prompt = [system, ...messages.map((message) => message.content)]
      .filter(Boolean)
      .join('\n')
    await guardrails.reserveBudget(
      budgetRequestId,
      estTokens(prompt) + maxOutputTokens(),
      budgetDay,
    )
    activeReservation = true
  }

  // 护栏全过，回合已领取（claim 在 provider 调用前；失败/中止的请求同样计入一次尝试——注释见 guardrails）。
  const record: TurnContext['record'] = async (system, userText, assistantText, usage) => {
    opts.signal?.throwIfAborted()
    const prompt = [system, ...history.map((m) => m.content), userText].filter(Boolean).join('\n')
    if (!activeReservation) {
      await guardrails.reserveBudget(
        budgetRequestId,
        estTokens(prompt) + estTokens(assistantText),
        budgetDay,
      )
      activeReservation = true
    }
    const measured = validUsage(usage)
    await guardrails.settleBudget(budgetRequestId, {
      day: budgetDay,
      model,
      promptTokens: measured?.promptTokens ?? estTokens(prompt),
      completionTokens: measured?.completionTokens ?? estTokens(assistantText),
      sessionKey: req.sessionKey,
    })
    activeReservation = false
    guardrails.pushTurn(req.sessionKey, 'user', userText)
    guardrails.pushTurn(req.sessionKey, 'assistant', assistantText)
  }

  /** 流式转发 provider 输出：每段 delta 透传为 SSE 帧，返回完整回复文本供落库。
   * 三个 mode 共用同一逐字结构——yield 不能出现在箭头闭包内，但内嵌 async function* + yield*
   * 可以安全复用，不必复制粘贴这段流式循环。 */
  async function* stream(
    system: string,
    messages: AiContext['messages'],
  ): AsyncGenerator<{ type: 'delta'; text: string }, ProviderReply> {
    opts.signal?.throwIfAborted()
    await reserveFor(system, messages)
    opts.signal?.throwIfAborted()
    let assistant = ''
    let usage: AiUsage | undefined
    providerStarted = true
    for await (const chunk of provider.stream({
      system,
      maxTokens: maxOutputTokens(),
      messages,
      signal: opts.signal,
    })) {
      opts.signal?.throwIfAborted()
      if (typeof chunk === 'string') {
        assistant += chunk
        yield { type: 'delta', text: chunk }
      } else if (chunk.type === 'usage') {
        const measured = validUsage(chunk.usage)
        if (measured) usage = measured
      }
    }
    opts.signal?.throwIfAborted()
    return { text: assistant, usage }
  }

  try {
    yield* modeHandlers[req.mode]({
      req,
      text,
      history,
      retrieveProducts: retrieveForChat,
      stream,
      record,
    })
  } catch (e) {
    // provider 运行期失败 → 显式 error + UI 重试（P3：绝不静默降级到 Mock）
    yield toErrorEvent(e, traceId, elapsed())
  } finally {
    if (activeReservation) {
      try {
        if (providerStarted) await guardrails.abandonBudget(budgetRequestId)
        else await guardrails.releaseBudget(budgetRequestId)
      } catch {
        logAi('error', 'ai_budget_finalization_failed', {
          request_id: traceId,
          phase: 'chat',
          elapsed_ms: elapsed(),
        })
      }
    }
  }
}
