// 真实流式客户端（规格 §8.3.2：AI_API_KEY + AI_BASE_URL/AI_MODEL 可配；OpenAI 兼容网关）。
// OpenAI client 每次调用惰性构造：既避免无 key 模块加载即抛错，也让 env 变更（测试 stub/部署重启）生效。
import OpenAI from 'openai'
import type { AiContext, AiProvider } from './provider'

// 单一事实源：真实 provider 的缺省模型（chat 记账与流式调用共用，见 provider.ts aiModel()）。
export const DEFAULT_AI_MODEL = 'gpt-4o-mini'

const TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 20_000) // 规格 §8.5.2 默认 20s
const AI_MODEL = process.env.AI_MODEL ?? DEFAULT_AI_MODEL

export class OpenAICompatProvider implements AiProvider {
  async *stream(ctx: AiContext & { system: string; maxTokens: number }): AsyncGenerator<string> {
    const client = new OpenAI({
      apiKey: process.env.AI_API_KEY ?? '',
      baseURL: process.env.AI_BASE_URL || undefined,
    })
    const stream = await client.chat.completions.create(
      {
        model: AI_MODEL,
        max_tokens: ctx.maxTokens,
        messages: [{ role: 'system', content: ctx.system }, ...ctx.messages],
        stream: true,
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) yield delta
    }
  }
}
