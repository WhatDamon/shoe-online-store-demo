import { envIntMax } from '@/config'

/** 单条用户消息字符上限（调用时读 env，见 config）。 */
export const maxMessageChars = () => envIntMax('AI_MAX_MESSAGE_CHARS', 800, 4_000)
/** 单次回复输出 token 上限（调用时读 env，见 config）。 */
export const maxOutputTokens = () => envIntMax('AI_MAX_OUTPUT_TOKENS', 500, 2_000)

/**
 * CJK 字符类：汉字（含扩展区）、假名、韩文，以及 CJK 标点与全角形式。
 * 这些字符在真实词表里基本各占一个（或更多）token，混进「4 字 1 token」里会被低估约 4 倍。
 */
const CJK_CHAR =
  /[\u2E80-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{20000}-\u{3FFFF}]/u

/**
 * 估算一段文本的 token 数（日预算的预占与结算都按它计数）。
 *
 * **按字符类**而不是按请求语言取比率：中文界面里的英文提问、英文界面里的中文提问都要算准，
 * 按 locale 分流只会让跨语言输入退化成低估。CJK 码点每个记 `char.length`（BMP 1、扩展区 2），
 * 其余字符按 4 字 1 token——与旧公式的英文结果逐位相同（`0.25` 是 2 的负幂，求和无舍入误差），
 * 故英文侧的预算数字不受本次改动影响。
 *
 * 不变量：**纯中文文本 `estTokens(s) >= s.length`**。旧公式 `len/4` 把中文低估约 4 倍，
 * 使 `AI_DAILY_TOKEN_CAP` 可被中文请求穿透——那是成本/滥用边界，不是体验问题。
 */
export const estTokens = (s: string): number => {
  let tokens = 0
  for (const char of s) tokens += CJK_CHAR.test(char) ? char.length : 0.25
  return Math.ceil(tokens)
}

export const truncateMessage = (s: string) =>
  s.length > maxMessageChars() ? s.slice(0, maxMessageChars()) : s
