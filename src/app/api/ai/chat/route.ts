// POST /api/ai/chat → SSE 流（规格 §8.4）。匿名开放，成本护栏在 chat() 内全链执行。
// 每帧 = encodeEvent 输出（data: {…}\n\n）；客户端 parseEvent 消费。
import { chat } from '@/server/ai/chat'
import { encodeEvent } from '@/server/ai/events'
import type { ChatEvent, Mode } from '@/server/ai/events'

const MODES: readonly string[] = ['shopping', 'size-fit', 'outfit', 'find-shoes', 'support']

type Body = {
  sessionKey?: unknown
  mode?: unknown
  text?: unknown
  product?: unknown
}

export async function POST(req: Request) {
  const raw = (await req.json().catch(() => null)) as Body | null
  const body = raw && typeof raw === 'object' ? raw : {}

  const sessionKey =
    typeof body.sessionKey === 'string' && body.sessionKey !== ''
      ? body.sessionKey
      : crypto.randomUUID() // 未带会话 → 新匿名会话
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
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

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (ev: ChatEvent) => controller.enqueue(enc.encode(encodeEvent(ev)))
      try {
        for await (const ev of chat({ sessionKey, ip, mode, text, product })) {
          send(ev)
          if (ev.type === 'done' || ev.type === 'error') break
        }
      } catch {
        send({
          type: 'error',
          code: 'provider',
          message: 'Something went wrong — please try again.',
        })
      }
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}
