import { envIntMax } from '@/config'

/** 单条用户消息字符上限（调用时读 env，见 config）。 */
export const maxMessageChars = () => envIntMax('AI_MAX_MESSAGE_CHARS', 800, 4_000)
/** 单次回复输出 token 上限（调用时读 env，见 config）。 */
export const maxOutputTokens = () => envIntMax('AI_MAX_OUTPUT_TOKENS', 500, 2_000)
export const estTokens = (s: string) => Math.ceil(s.length / 4)
export const truncateMessage = (s: string) =>
  s.length > maxMessageChars() ? s.slice(0, maxMessageChars()) : s
