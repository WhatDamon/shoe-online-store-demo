'use client'

// SSE 会话消费 hook：管理消息流、流式增量、结构化事件（productCards/sizeFit）
// 与错误恢复。帧解析委托 events.ts 的 parseEvent（客户端可导入纯函数，不在 UI 侧重复造解析）。
import { useCallback, useRef, useState } from 'react'
import { parseEvent } from '@/server/ai/events'
import type { ChatErrorCode, ChatEvent, Mode, ProductCard } from '@/server/ai/events'
import type { CanonicalSize } from '@/server/catalog/types'

/** 发给服务端的最小商品引用（只需 handle + title，规格 §8.4 ChatRequest.product）。 */
interface ChatProductRef {
  handle: string
  title: string
}

interface SizeFitResult {
  recommended: CanonicalSize
  alternatives: CanonicalSize[]
  rationale: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 挂在助手消息上（productCards 帧到达时写入）。 */
  cards?: ProductCard[]
  /** 挂在助手消息上（size-fit 结构化推荐）。 */
  sizeFit?: SizeFitResult
  streaming?: boolean
  /** 该回合失败（护栏/provider/网络）时的温和文案。 */
  error?: { code: ChatErrorCode; message: string } | null
}

export interface ChatStream {
  messages: ChatMessage[]
  isStreaming: boolean
  /** 最近一次失败展示文案（消费端措辞）。 */
  error: string | null
  errorCode: ChatErrorCode | null
  send: (mode: Mode, text: string, product?: ChatProductRef | null) => void
  /** 重发最近一次请求（error 后 "Try again"）。 */
  retry: () => void
}

const NETWORK_ERROR_TEXT = 'Something went wrong on our end — please try again.'

/** 结果卡运行时 shape 守卫：parseEvent 对 productCards 只验 Array.isArray，坏 item
 *  （缺 handle/palette/字段类型错）会让渲染崩溃或兜底不可用，故在入口过滤，
 *  渲染侧只需消费干净数据。不要求价格——AI 卡片不带价（价格只在详情页/店铺）。 */
function isValidCard(c: unknown): c is ProductCard {
  if (typeof c !== 'object' || c === null) return false
  const o = c as Record<string, unknown>
  return (
    typeof o.handle === 'string' &&
    o.handle.length > 0 &&
    typeof o.title === 'string' &&
    o.title.length > 0 &&
    typeof o.subtitle === 'string' &&
    (o.image === null || typeof o.image === 'string') &&
    (o.imageKind === 'photo' || o.imageKind === 'svg') &&
    typeof o.photoCount === 'number' &&
    Number.isFinite(o.photoCount) &&
    o.photoCount >= 0 &&
    (o.sizeRange === null || typeof o.sizeRange === 'string') &&
    typeof o.colorCount === 'number' &&
    Number.isFinite(o.colorCount) &&
    o.colorCount >= 0 &&
    Array.isArray(o.palette) &&
    o.palette.length >= 2 &&
    (o.palette as unknown[]).every((x) => typeof x === 'string' && x.length > 0)
  )
}

const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** 逐行读取 SSE 帧并回调；行以 \n 分隔（encodeEvent 帧尾 \n\n）。 */
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const event = parseEvent(line)
      if (event) onEvent(event)
    }
  }
}

export function useChatStream(): ChatStream {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<ChatErrorCode | null>(null)
  const sessionKeyRef = useRef<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastReqRef = useRef<{
    mode: Mode
    text: string
    product: ChatProductRef | null
  } | null>(null)

  const send = useCallback((mode: Mode, text: string, product?: ChatProductRef | null) => {
    // 重发/新回合：终止上一路未完成的流
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const p = product ?? null
    lastReqRef.current = { mode, text, product: p }
    setError(null)
    setErrorCode(null)

    const userContent = text.trim()
    const userMessage: ChatMessage | null = userContent
      ? { id: uid(), role: 'user', content: text }
      : null
    const assistantMessage: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      streaming: true,
    }
    activeIdRef.current = assistantMessage.id
    setMessages((prev) =>
      userMessage ? [...prev, userMessage, assistantMessage] : [...prev, assistantMessage],
    )
    setIsStreaming(true)

    const onEvent = (event: ChatEvent) => {
      const id = activeIdRef.current
      if (!id) return
      if (event.type === 'delta') {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, content: m.content + event.text } : m)),
        )
      } else if (event.type === 'productCards') {
        const items = event.items.filter(isValidCard)
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, cards: items } : m)))
      } else if (event.type === 'sizeFit') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  sizeFit: {
                    recommended: event.recommended,
                    alternatives: event.alternatives,
                    rationale: event.rationale,
                  },
                }
              : m,
          ),
        )
      } else if (event.type === 'done') {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)))
      } else if (event.type === 'error') {
        const failure = { code: event.code, message: event.message }
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, streaming: false, error: failure } : m)),
        )
        setError(event.message)
        setErrorCode(event.code)
      }
    }

    void (async () => {
      try {
        const sessionKey = (sessionKeyRef.current ??= uid())
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionKey,
            mode,
            text: userContent,
            product: p,
          }),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`chat request failed: HTTP ${res.status}`)
        await consumeSSE(res.body, onEvent)
      } catch {
        // 被新请求终止：静默（onEvent 不再有意义，新流接管）
        if (controller.signal.aborted) return
        const failure = {
          code: 'provider' as ChatErrorCode,
          message: NETWORK_ERROR_TEXT,
        }
        setError(NETWORK_ERROR_TEXT)
        setErrorCode('provider')
        const id = activeIdRef.current
        if (id) {
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, streaming: false, error: failure } : m)),
          )
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setIsStreaming(false)
        }
      }
    })()
  }, [])

  const retry = useCallback(() => {
    const last = lastReqRef.current
    if (last) send(last.mode, last.text, last.product)
  }, [send])

  return { messages, isStreaming, error, errorCode, send, retry }
}
