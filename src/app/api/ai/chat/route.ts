// POST /api/ai/chat → SSE 流。匿名开放，成本护栏在 chat() 内全链执行。
// 每帧 = encodeEvent 输出（data: {…}\n\n）；客户端 parseEvent 消费。
import { chat, FALLBACK_ERROR_TEXT } from '@/server/ai/chat'
import { encodeEvent } from '@/domain/chat-events'
import type { ChatEvent, Mode } from '@/domain/chat-events'
import {
  AI_SESSION_COOKIE,
  AI_SESSION_MAX_AGE_SECONDS,
  requestIp,
  sessionIdFrom,
} from '@/server/guardrails/request'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const MODES: readonly string[] = ['shopping', 'size-fit', 'outfit', 'find-shoes', 'support']

type Body = {
  mode?: unknown
  text?: unknown
  product?: unknown
  footMm?: unknown
}

export async function POST(req: NextRequest) {
  const raw = (await req.json().catch(() => null)) as Body | null
  const body = raw && typeof raw === 'object' ? raw : {}
  const session = sessionIdFrom(req)
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

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (ev: ChatEvent) => controller.enqueue(enc.encode(encodeEvent(ev)))
      try {
        for await (const ev of chat({ sessionKey: session.id, ip, mode, text, product, footMm })) {
          send(ev)
          if (ev.type === 'done' || ev.type === 'error') break
        }
      } catch {
        send({
          type: 'error',
          code: 'provider',
          message: FALLBACK_ERROR_TEXT,
        })
      }
      controller.close()
    },
  })
  const response = new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
  response.cookies.set(AI_SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: AI_SESSION_MAX_AGE_SECONDS,
  })
  return response
}
