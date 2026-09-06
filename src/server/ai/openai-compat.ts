// 真实流式客户端（规格 §8.3.2：AI_API_KEY + AI_BASE_URL/AI_MODEL 可配；OpenAI 兼容网关）。
// OpenAI client 每次调用惰性构造：既避免无 key 模块加载即抛错，也让 env 变更（测试 stub/部署重启）生效。
import OpenAI from 'openai'
import { envInt } from '@/server/guardrails/env-int'
import type { AiContext, AiProvider } from './provider'

// 单一事实源：真实 provider 的缺省模型（chat 记账与流式调用共用，见 provider.ts aiModel()）。
// 2026-09 调研后更新：gpt-4o-mini 已属旧档（ChatGPT 端 2026-02 退役，API 侧亦在官方迁移清单）。
// 本应用为低频导购对话（输出≤500 tok、无长链推理），选新旗舰 5.6 系最平价档 gpt-5.6-luna
// （$0.20/M 输入 / $1.20/M 输出，1M ctx，官方指定为 nano 档接替者）；需要更强质量时置 AI_MODEL=gpt-5.6-terra。
// 任何 OpenAI 兼容网关（含 ModelScope 等中转）均可在环境变量里换用对应低价模型名。
export const DEFAULT_AI_MODEL = 'gpt-5.6-luna'

const TIMEOUT_MS = envInt('AI_REQUEST_TIMEOUT_MS', 20_000) // 规格 §8.5.2 默认 20s
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
