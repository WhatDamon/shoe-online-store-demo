// AiProvider 契约。
// stream 产出文本 delta，并可在末尾产出 provider usage；productCards/sizeFit 等结构化事件由 chat() 编排产出。
//
// 本模块**只放类型**：工厂在 factory.ts，两个实现（mock / openai-compat）只 type-import 这里。
// 这样依赖方向单向（factory → 实现 → 接口），不会出现 provider ⇄ 实现的 import 环；
// 往本文件加运行时 import 会立刻把环带回来。
export interface AiContext {
  messages: { role: 'user' | 'assistant'; content: string }[]
  signal?: AbortSignal
}

export interface AiUsage {
  promptTokens: number
  completionTokens: number
}

export type AiStreamChunk = string | { type: 'usage'; usage: AiUsage }

export interface AiProvider {
  stream(ctx: AiContext & { system: string; maxTokens: number }): AsyncGenerator<AiStreamChunk> // text deltas, followed optionally by usage
}
