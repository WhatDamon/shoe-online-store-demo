// AiProvider 契约 + 工厂（规格 §8.3/§8.5.5：无 key = Mock；有 key = OpenAICompat；AI_DISABLE_REAL 强制 Mock）。
// stream 只产出文本 delta；productCards/sizeFit 等结构化事件由 chat() 编排产出，Mock 与真实同构。
export interface AiContext {
  messages: { role: 'user' | 'assistant'; content: string }[]
}

export interface AiProvider {
  stream(
    ctx: AiContext & { system: string; maxTokens: number },
  ): AsyncGenerator<string> // text deltas only
}

// 工厂按调用时 env 决策（测试可 vi.stubEnv 后再调 chat）。
// mock/openai-compat 仅 type-import 本模块（运行时不回环），故此处顶层运行时 import 安全。
import { OpenAICompatProvider } from './openai-compat'
import { MockProvider } from './mock'

export const aiProvider = (): AiProvider =>
  process.env.AI_API_KEY && process.env.AI_DISABLE_REAL !== '1'
    ? new OpenAICompatProvider()
    : new MockProvider()
