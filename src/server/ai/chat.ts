// chat() 编排（护栏 → 模式分发 → 检索/上下文 → 流 → 事件行）。
// RAG-lite 零工具调用：检索命中经 digest/system 注入，模型只能基于注入内容作答（§8.2/§8.5.4）。
// 本文件只管护栏顺序、上下文装配与错误映射；每个 mode 具体怎么回答见 handlers.ts。
import { createGuardrails, GuardrailError, type Guardrails } from '@/server/guardrails'
import type { SessionMessage } from '@/server/guardrails/session-state'
import { estTokens, maxOutputTokens, truncateMessage } from '@/server/guardrails/text'
import { today } from '@/server/guardrails/budget'
import { createDefaultRepository } from '@/server/search/repository'
import type { ChatEvent } from '@/domain/chat-events'
import type { AiContext, AiProvider } from './provider'
import { aiModel, aiProvider } from './factory'
import { modeHandlers } from './handlers'
import type { ChatRequest, TurnContext } from './turn'

export type { ChatRequest } from './turn'

export interface ChatOptions {
  /** 测试注入：内存库护栏实例；生产省略 → 模块级共享单例（跨请求计数才有意义）。 */
  guardrails?: Guardrails
  /** 测试注入：固定 provider；默认按 env 工厂选 Mock/真实。 */
  provider?: AiProvider
}

/** 流内异常的统一文案；`/api/ai/chat` 的兜底 catch 也用它（单一来源）。 */
export const FALLBACK_ERROR_TEXT = 'Something went wrong — please try again.'

let shared: Guardrails | null = null
const sharedGuardrails = (): Guardrails => (shared ??= createGuardrails(createDefaultRepository()))

/** GuardrailError → 对应 code + 温和文案（code 1:1 透传，含 'turns'）；其余 → provider 错误。 */
const toErrorEvent = (e: unknown): ChatEvent => {
  if (e instanceof GuardrailError) {
    // 护栏拒绝（rate_limited/budget/turns）是设计内软拒绝：仅记录 code（不携带会话/内容/访客信息），
    // 便于 Vercel 端区分「配置误伤（如空 env 把预算打成 0）」与真实滥用；UI 仍只显示温和文案。
    console.warn('[ai/chat] guardrail refusal', e.code)
    return { type: 'error', code: e.code, message: e.message }
  }
  // 根因上浮到部署日志（Vercel 函数日志可见）；UI 只显示通用 Try Again 文案，不向访客泄露细节。
  console.error('[ai/chat] provider failure', e)
  return { type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }
}

/** 护栏顺序：rate → budget → turns；被 rate/budget 拒的请求不消耗回合（回合 claim 最后执行）。
 * 三者任一失败都只回一个 error 帧，故合并为一个 try —— 原先是三个逐字相同的 try/catch。 */
export async function* chat(req: ChatRequest, opts: ChatOptions = {}): AsyncGenerator<ChatEvent> {
  const guardrails = opts.guardrails ?? sharedGuardrails()
  const provider = opts.provider ?? aiProvider()
  const text = truncateMessage(req.text ?? '')
  // 记账模型与实际选中的 provider 同源（修复：勿用 AI_MODEL ?? 'mock'，会把真实调用记成 mock）。
  const model = aiModel()

  let history: SessionMessage[]
  try {
    guardrails.assertRate(req.ip, req.sessionKey)
    await guardrails.assertBudget()
    history = guardrails.assertTurn(req.sessionKey)
  } catch (e) {
    yield toErrorEvent(e)
    return
  }

  // 护栏全过，回合已领取（claim 在 provider 调用前；失败/中止的请求同样计入一次尝试——注释见 guardrails）。
  const record: TurnContext['record'] = async (system, userText, assistantText) => {
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

  /** 流式转发 provider 输出：每段 delta 透传为 SSE 帧，返回完整回复文本供落库。
   * 三个 mode 共用同一逐字结构——yield 不能出现在箭头闭包内，但内嵌 async function* + yield*
   * 可以安全复用，不必复制粘贴这段流式循环。 */
  async function* stream(
    system: string,
    messages: AiContext['messages'],
  ): AsyncGenerator<{ type: 'delta'; text: string }, string> {
    let assistant = ''
    for await (const delta of provider.stream({
      system,
      maxTokens: maxOutputTokens(),
      messages,
    })) {
      assistant += delta
      yield { type: 'delta', text: delta }
    }
    return assistant
  }

  try {
    yield* modeHandlers[req.mode]({ req, text, history, stream, record })
  } catch (e) {
    // provider 运行期失败 → 显式 error + UI 重试（P3：绝不静默降级到 Mock）
    yield toErrorEvent(e)
  }
}
