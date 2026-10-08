// POST /api/ai/chat → SSE 流。匿名开放，成本护栏在 chat() 内全链执行。
// 每帧 = encodeEvent 输出（data: {…}\n\n）；客户端 parseEvent 消费。
import { chat, FALLBACK_ERROR_TEXT } from '@/server/ai/chat'
import { encodeEvent } from '@/domain/chat-events'
import type { ChatEvent, Mode } from '@/domain/chat-events'
import { maxMessageChars } from '@/server/guardrails/text'
import { readRequestBody } from '@/server/guardrails/request-body'
import {
  AI_SESSION_COOKIE,
  isSameOriginRequest,
  requestIp,
  sessionIdFrom,
  SessionConfigurationError,
  type AISession,
} from '@/server/guardrails/request'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MODES: readonly string[] = ['shopping', 'size-fit', 'outfit', 'find-shoes', 'support']
const MAX_BODY_BYTES = 16 * 1024
const MAX_PRODUCT_HANDLE_CHARS = 100
const MAX_PRODUCT_TITLE_CHARS = 200
const MIN_FOOT_MM = 200
const MAX_FOOT_MM = 330

type Body = {
  mode?: unknown
  text?: unknown
  product?: unknown
  footMm?: unknown
  /** Legacy client field is accepted for compatibility but never trusted. */
  sessionKey?: unknown
}

type ParsedBody = {
  mode: Mode
  text: string
  product: { handle: string; title: string } | null
  footMm: number | null
}

const hasControlCharacter = (value: string): boolean => /[\u0000-\u001f\u007f]/.test(value)

function parseBody(value: unknown): ParsedBody | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Body
  if (
    Object.keys(body).some(
      (key) => !['mode', 'text', 'product', 'footMm', 'sessionKey'].includes(key),
    )
  ) {
    return null
  }
  if (body.mode !== undefined && (typeof body.mode !== 'string' || !MODES.includes(body.mode))) {
    return null
  }
  if (
    body.text !== undefined &&
    (typeof body.text !== 'string' ||
      body.text.length > maxMessageChars() ||
      hasControlCharacter(body.text))
  ) {
    return null
  }
  let product: ParsedBody['product'] = null
  if (body.product !== undefined && body.product !== null) {
    if (typeof body.product !== 'object' || Array.isArray(body.product)) return null
    const candidate = body.product as { handle?: unknown; title?: unknown }
    if (
      typeof candidate.handle !== 'string' ||
      typeof candidate.title !== 'string' ||
      candidate.handle.length === 0 ||
      candidate.handle.length > MAX_PRODUCT_HANDLE_CHARS ||
      !/^[a-z0-9][a-z0-9-]*$/.test(candidate.handle) ||
      candidate.title.length === 0 ||
      candidate.title.length > MAX_PRODUCT_TITLE_CHARS ||
      hasControlCharacter(candidate.title)
    ) {
      return null
    }
    product = { handle: candidate.handle, title: candidate.title }
  }
  if (
    body.footMm !== undefined &&
    body.footMm !== null &&
    (typeof body.footMm !== 'number' ||
      !Number.isFinite(body.footMm) ||
      body.footMm < MIN_FOOT_MM ||
      body.footMm > MAX_FOOT_MM)
  ) {
    return null
  }
  return {
    mode: (body.mode as Mode | undefined) ?? 'shopping',
    text: body.text ?? '',
    product,
    footMm: body.footMm ?? null,
  }
}

async function readBody(req: NextRequest): Promise<ParsedBody | null> {
  try {
    const bytes = await readRequestBody(req, MAX_BODY_BYTES)
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return parseBody(JSON.parse(raw))
  } catch {
    return null
  }
}

function invalidRequest(requestId: string): NextResponse {
  return NextResponse.json(
    { code: 'invalid_request', message: 'Request validation failed' },
    { status: 422, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
  )
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { code: 'invalid_origin', message: 'Request origin is not allowed.' },
      { status: 403, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
    )
  }
  const body = await readBody(req)
  if (!body) return invalidRequest(requestId)

  let session: AISession
  try {
    session = sessionIdFrom(req)
  } catch (error) {
    if (!(error instanceof SessionConfigurationError)) throw error
    return NextResponse.json(
      { code: 'session_unavailable', message: FALLBACK_ERROR_TEXT },
      { status: 503, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
    )
  }
  const ip = requestIp(req)
  const { mode, text, product, footMm } = body

  const cancellation = new AbortController()
  const signal = AbortSignal.any([req.signal, cancellation.signal])
  const iterator = chat(
    { sessionKey: session.id, ip, mode, text, product, footMm },
    { signal, requestId },
  )
  const enc = new TextEncoder()
  let finished = false
  const stream = new ReadableStream({
    async pull(controller) {
      if (finished) return
      try {
        const next = await iterator.next()
        if (finished) return
        if (next.done) {
          finished = true
          controller.close()
          return
        }
        controller.enqueue(enc.encode(encodeEvent(next.value)))
        if (next.value.type === 'done' || next.value.type === 'error') {
          finished = true
          controller.close()
          try {
            await iterator.return(undefined)
          } catch {
            console.error(
              JSON.stringify({ event: 'ai_stream_cleanup_failed', request_id: requestId }),
            )
          }
        }
      } catch {
        if (finished) return
        finished = true
        const event: ChatEvent = {
          type: 'error',
          code: 'provider',
          message: FALLBACK_ERROR_TEXT,
        }
        controller.enqueue(enc.encode(encodeEvent(event)))
        controller.close()
      }
    },
    async cancel() {
      finished = true
      cancellation.abort()
      try {
        await iterator.return(undefined)
      } catch {
        console.error(JSON.stringify({ event: 'ai_stream_cleanup_failed', request_id: requestId }))
      }
    },
  })
  const response = new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-request-id': requestId,
      connection: 'keep-alive',
    },
  })
  response.cookies.set(AI_SESSION_COOKIE, session.cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || req.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000)),
    expires: new Date(session.expiresAt * 1000),
  })
  return response
}
