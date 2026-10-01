// POST /api/ai/chat → SSE 流。匿名开放，成本护栏在 chat() 内全链执行。
// 每帧 = encodeEvent 输出（data: {…}\n\n）；客户端 parseEvent 消费。
import { chat, FALLBACK_ERROR_TEXT } from '@/server/ai/chat'
import { encodeEvent } from '@/domain/chat-events'
import type { ChatEvent, Mode } from '@/domain/chat-events'
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

type Body = {
  mode?: unknown
  text?: unknown
  product?: unknown
  footMm?: unknown
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { code: 'invalid_origin', message: 'Request origin is not allowed.' },
      { status: 403, headers: { 'cache-control': 'no-store' } },
    )
  }
  let session: AISession
  try {
    session = sessionIdFrom(req)
  } catch (error) {
    if (!(error instanceof SessionConfigurationError)) throw error
    return NextResponse.json(
      { code: 'session_unavailable', message: FALLBACK_ERROR_TEXT },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
  const raw = (await req.json().catch(() => null)) as Body | null
  const body = raw && typeof raw === 'object' ? raw : {}
  const ip = requestIp(req)
  const mode: Mode =
    typeof body.mode === 'string' && MODES.includes(body.mode) ? (body.mode as Mode) : 'shopping'
  const text = typeof body.text === 'string' ? body.text : ''
  const product =
    typeof body.product === 'object' &&
    body.product !== null &&
    typeof (body.product as { handle?: unknown }).handle === 'string' &&
    typeof (body.product as { title?: unknown }).title === 'string'
      ? {
          handle: (body.product as { handle: string }).handle,
          title: (body.product as { title: string }).title,
        }
      : null
  const footMm =
    typeof body.footMm === 'number' && Number.isFinite(body.footMm) ? body.footMm : null

  const cancellation = new AbortController()
  const signal = AbortSignal.any([req.signal, cancellation.signal])
  const iterator = chat({ sessionKey: session.id, ip, mode, text, product, footMm }, { signal })
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
            console.error('[ai/chat] stream cleanup failed')
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
        console.error('[ai/chat] cancellation cleanup failed')
      }
    },
  })
  const response = new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
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
