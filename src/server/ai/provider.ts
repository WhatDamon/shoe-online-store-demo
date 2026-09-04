// AiProvider 契约 + 工厂（规格 §8.3/§8.5.5：无 key = Mock；有 key = OpenAICompat；AI_DISABLE_REAL 强制 Mock）。
// stream 只产出文本 delta；productCards/sizeFit 等结构化事件由 chat() 编排产出，Mock 与真实同构。
export interface AiContext {
  messages: { role: 'user' | 'assistant'; content: string }[]
}

export interface AiProvider {
  stream(ctx: AiContext & { system: string; maxTokens: number }): AsyncGenerator<string> // text deltas only
}

// 工厂按调用时 env 决策（测试可 vi.stubEnv 后再调 chat）。
// mock/openai-compat 仅 type-import 本模块（运行时不回环），故此处顶层运行时 import 安全。
import { OpenAICompatProvider, DEFAULT_AI_MODEL } from './openai-compat'
import { MockProvider } from './mock'

/** 是否命中真实 provider（与 aiProvider() 同一判定）。 */
const realEnabled = (): boolean =>
  Boolean(process.env.AI_API_KEY) && process.env.AI_DISABLE_REAL !== '1'

export const aiProvider = (): AiProvider =>
  realEnabled() ? new OpenAICompatProvider() : new MockProvider()

// 实际生效的模型（规格：记账与流式必须同源）：Mock → 'mock'；真实 → AI_MODEL ?? 缺省。
export const aiModel = (): string =>
  realEnabled() ? (process.env.AI_MODEL ?? DEFAULT_AI_MODEL) : 'mock'
