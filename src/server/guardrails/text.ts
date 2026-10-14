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
 * 2. **纯 CJK 文本恒有 `estTokens(s) === s.length`**，BMP 与扩展区都成立：`char.length` 就是该
 *    码点的 UTF-16 长度（BMP 1、扩展区 2），故对只含 CJK 类码点的串求和恰等于 `s.length`。
 *    实测：`estTokens('\u{20000}') === 2`（1 个码点、2 个 UTF-16 单元），`estTokens('中文\u{20000}文') === 5`。
 *    这修掉了旧公式 `len/4` 把中文低估 3–4 倍的病根——中文不再被低估。
 *
 * **仍只是估算，不是上限**：只有 CJK 类码点按 1 字 1 token 计，其余一律 `0.25`/字符——那对英文是
 * 刻意保留的近似，但 emoji 等「1 个字形往往 >1 token」的码点仍会被明显低估（实测
 * `estTokens('🎉👟') === 1`，而其 UTF-16 长度是 4、码点数 2），故日预算仍可能被非 CJK 输入穿透。
 * 它堵的是「中文请求把 `AI_DAILY_TOKEN_CAP` 穿透 3–4 倍」那个病根（成本/滥用边界），
 * 不是「任何输入都不可能超过预算」。
 */
export const estTokens = (s: string): number => {
  let tokens = 0
  for (const char of s) tokens += CJK_CHAR.test(char) ? char.length : 0.25
  return Math.ceil(tokens)
}

export const truncateMessage = (s: string) =>
  s.length > maxMessageChars() ? s.slice(0, maxMessageChars()) : s
