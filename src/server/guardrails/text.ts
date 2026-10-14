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
 * 其余字符按 4 字 1 token。
 *
 * 两条理由注释（改公式前先读；它们才是「公式换成按字符类、英文侧预算却不必跟着动」的依据）：
 * 1. 英文结果与旧公式 `Math.ceil(s.length / 4)` **逐位相同**：非 CJK 字符各记 `0.25`，而 `0.25`
 *    是 2 的负幂、二进制下精确可表示 ⇒ 任意长度求和无舍入漂移，故旧公式的英文预算数字原样保留。
 * 2. **纯中文恒有 `estTokens(s) === s.length`**（中文汉字与中文标点各 `char.length === 1`，
 *    约 1 字 1 token）。这是**日预算不被穿透的判据**：旧公式 `len/4` 把中文低估 3–4 倍，
 *    使 `AI_DAILY_TOKEN_CAP` 可被中文请求穿透——那是成本/滥用边界，不是体验问题。
 */
export const estTokens = (s: string): number => {
  let tokens = 0
  for (const char of s) tokens += CJK_CHAR.test(char) ? char.length : 0.25
  return Math.ceil(tokens)
}

export const truncateMessage = (s: string) =>
  s.length > maxMessageChars() ? s.slice(0, maxMessageChars()) : s
