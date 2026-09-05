/**
 * 浏览器端语音朗读（Web Speech API，客户端 only）。
 *
 * 职责边界：只做「能力检测 / 文本清理 / 朗读执行」，不持有 UI 状态。
 * 开关偏好与触发策略在组件层（assistant 面板/provider），本模块可独立单测。
 *
 * 已知浏览器限制（写代码时确认，不 hack、不假装解决）：
 * - iOS Safari 部分版本要求首次发声发生在用户手势栈内——自动朗读的首次出声
 *   可能被系统策略静音；本模块不为此做手势预热 hack。
 * - Chrome/Edge 桌面对单条 utterance 有 ~15s/长文本截断 bug，故朗读前把文本
 *   切成 ~200 字符的句子块，逐块 speak 并在上一块 onend 后再发下一块
 *   （连续 speak 太快也会互相吞话，链式 onend 一并规避）。
 * - 不指定 voice（走系统默认，经 utterance.lang 提示语向），不提供
 *   voice/语速/pause 管理（克制 YAGNI；产品文案无 "TTS"/"AI" 字样，P1）。
 */

/** 浏览器当前是否提供 TTS。SSR/旧浏览器返回 false → 调用方应隐藏入口。 */
export const isSpeechSupported = (): boolean => {
  if (typeof window === 'undefined') return false
  if (typeof window.speechSynthesis !== 'object' || window.speechSynthesis === null) return false
  return typeof window.SpeechSynthesisUtterance === 'function'
}

/**
 * markdown 明文 → 可朗读纯文本（纯函数）。
 * 与 markdown-lite 渲染子集对齐（粗体/行内代码/项目符号行），另做防御性
 * 剥离链接语法、标题符与有序列表，避免朗读时把标记符号念出来。
 */
export const toSpeechText = (md: string): string => {
  if (!md) return ''
  return (
    md
      // [text](url) → text（图片 ![alt](url) → alt 同样命中组 1）
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // **粗体** → 粗体；`代码` → 代码
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      // 标题符与列表前缀（行首）
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      // 引用符号与多余空行
      .replace(/^\s*>\s?/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * 把长文本按可朗读块切分（纯函数，便于单测）。
 * 优先在段落/句子边界断句，单块硬上限 maxLen 字符；fallback 硬切避免
 * 超长 utterance 触发 Chrome ~15s 截断。块之间不吞标点。
 */
export const chunkForSpeech = (text: string, maxLen = 200): string[] => {
  const src = text.trim()
  if (!src) return []
  if (src.length <= maxLen) return [src]
  const parts = src.split(/(\n\n+)/)
  const out: string[] = []
  let buf = ''
  const flush = () => {
    if (buf.trim()) out.push(buf.trim())
    buf = ''
  }
  const pushWordGroup = (group: string) => {
    // 句子边界（英文句点/问号/感叹号/分号/换行），尽量在边界断
    const sentences = group.split(/(?<=[.!?;:]\s+|\n)/)
    for (const sent of sentences) {
      if (!sent) continue
      if ((buf + sent).length <= maxLen) {
        buf += sent
      } else {
        flush()
        if (sent.length <= maxLen) {
          buf = sent
        } else {
          // 单句超长：按空白硬切
          let rest = sent
          while (rest.length > maxLen) {
            let cut = rest.lastIndexOf(' ', maxLen)
            if (cut <= 0) cut = maxLen
            out.push(rest.slice(0, cut).trim())
            rest = rest.slice(cut).trimStart()
          }
          if (rest) buf = rest
        }
      }
    }
  }
  for (const part of parts) {
    if (/^\n+$/.test(part)) {
      flush() // 段落空行 → 自然停顿
      continue
    }
    pushWordGroup(part)
  }
  flush()
  return out
}

/** 内部：当前朗读队列与代际 token（cancel/新朗读使旧 onend 失效）。 */
let queue: string[] = []
let generation = 0

/** 朗读一段纯文本（调用方先 toSpeechText）。不支持的浏览器静默 no-op。 */
export const readAloud = (text: string): void => {
  const synth = getSynth()
  const Utterance = getUtteranceCtor()
  if (!synth || !Utterance) return
  const chunks = chunkForSpeech(text)
  if (chunks.length === 0) return
  generation += 1
  const myGen = generation
  queue = [...chunks]
  synth.cancel() // 打断正在进行的旧朗读（其 onend 经代际判定失效）
  const speakOne = () => {
    if (generation !== myGen) return
    const chunk = queue.shift()
    if (chunk === undefined) return
    const u = new Utterance(chunk)
    u.lang = 'en-US'
    u.onend = () => speakOne()
    // cancel/中断在部分浏览器走 onerror 而非 onend——同样以代际判定，
    // 只有仍属本次朗读的错误才跳块继续，外部打断则静默停。
    u.onerror = () => {
      if (generation === myGen) speakOne()
    }
    synth.speak(u)
  }
  speakOne()
}

/** 立即停止当前与排队中的朗读（新回复/关面板/关开关时调用）。 */
export const stopSpeaking = (): void => {
  generation += 1
  queue = []
  const synth = getSynth()
  if (synth) synth.cancel()
}

const getSynth = (): SpeechSynthesis | null => {
  if (typeof window === 'undefined') return null
  return typeof window.speechSynthesis === 'object' && window.speechSynthesis
    ? window.speechSynthesis
    : null
}

const getUtteranceCtor = (): (new (text: string) => SpeechSynthesisUtterance) | null => {
  if (typeof window === 'undefined') return null
  const Ctor = window.SpeechSynthesisUtterance
  return typeof Ctor === 'function' ? Ctor : null
}
