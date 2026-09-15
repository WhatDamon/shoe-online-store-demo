// 单轮对话的输入契约与 mode 处理器接口。
// 独立成模块是为了打断 chat ↔ handlers 的循环：两侧都只依赖这里，这里不依赖任何一侧。
import type { SessionMessage } from '@/server/guardrails/session-state'
import type { ChatEvent, Mode } from '@/domain/chat-events'
import type { AiContext } from './provider'

export interface ChatRequest {
  sessionKey: string
  ip: string
  mode: Mode
  product?: { handle: string; title: string } | null
  text: string
  /** 「我的尺码」脚长 mm（可选预填）：size-fit 且文本无显式尺码时回退用之。 */
  footMm?: number | null
}

/** 逐段透传 provider 输出的 delta 帧，返回完整回复文本（供记账落库）。 */
export type StreamReplies = (
  system: string,
  messages: AiContext['messages'],
) => AsyncGenerator<{ type: 'delta'; text: string }, string>

/** 记一轮问答：写入会话历史 + 用量表。 */
export type RecordTurn = (system: string, userText: string, assistantText: string) => Promise<void>

/** 处理器可见的全部上下文。provider / guardrails 不在此列 —— 它们已被 stream / record 收拢，
 * 暴露出去只会让每个 handler 都能绕过护栏顺序。 */
export interface TurnContext {
  req: ChatRequest
  /** 已裁剪的入参文本（truncateMessage 结果），handler 不再重复裁剪。 */
  text: string
  history: SessionMessage[]
  stream: StreamReplies
  record: RecordTurn
}

export type ModeHandler = (ctx: TurnContext) => AsyncGenerator<ChatEvent, void, void>
