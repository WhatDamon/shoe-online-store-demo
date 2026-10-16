import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AI_SESSION_COOKIE } from '@/server/guardrails/request'

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('@/server/ai/chat', () => ({
  chat,
  // 既有的 503 断言期望消息为 'fallback'：mock 保持同一取值，只换成按语言取用的入口。
  fallbackErrorMessage: () => 'fallback',
}))

import { messages } from '@/i18n/messages'
import type { Locale } from '@/i18n/locales'
import { POST } from './route'

const now = new Date('2026-09-29T10:00:00Z')

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('AI_SESSION_SECRET', 'test-only-ai-session-key-not-for-deployment')
  vi.useFakeTimers()
  vi.setSystemTime(now)
  chat.mockImplementation(responseEvents)
})

afterEach(() => {
  chat.mockReset()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function responseEvents() {
  return (async function* () {
    yield { type: 'done' as const }
  })()
}

function request(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ text: 'hello' }),
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('AI chat route session boundary', () => {
  it('bounds producer reads and finalizes the generator when the reader cancels', async () => {
    let produced = 0
    let finalized = false
    let signal: AbortSignal
    chat.mockImplementation((_request, options) => {
      signal = options.signal
      return (async function* () {
        try {
          for (let i = 0; i < 100; i++) {
            produced++
            yield { type: 'delta', text: 'reply' }
          }
        } finally {
          finalized = true
        }
      })()
    })
    const response = await POST(request())
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    await Promise.resolve()
    expect(produced).toBeLessThanOrEqual(2)
    await reader.cancel()
    expect(signal!.aborted).toBe(true)
    expect(finalized).toBe(true)
  })

  it('aborts a pending provider read on cancellation without writing to a closed stream', async () => {
    let finalized = false
    let markWaiting: () => void
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve
    })
    chat.mockImplementation((_request, { signal }) =>
      (async function* () {
        try {
          yield { type: 'delta', text: 'partial' }
          markWaiting()
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        } finally {
          finalized = true
        }
      })(),
    )
    const response = await POST(request())
    const reader = response.body!.getReader()
    await reader.read()
    const pending = reader.read()
    await waiting
    await reader.cancel()
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(finalized).toBe(true)
  })

  it('links the inbound request abort signal and safely reports iterator failures', async () => {
    const cancellation = new AbortController()
    let finalized = false
    chat.mockImplementation((_request, { signal }) =>
      (async function* () {
        try {
          yield { type: 'delta', text: 'partial' }
          await new Promise<void>((_resolve, reject) => {
            if (signal.aborted) reject(new Error('private-provider-message'))
            else
              signal.addEventListener(
                'abort',
                () => reject(new Error('private-provider-message')),
                { once: true },
              )
          })
        } finally {
          finalized = true
        }
      })(),
    )
    const response = await POST(
      new NextRequest('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ text: 'hello' }),
        signal: cancellation.signal,
      }),
    )
    const reader = response.body!.getReader()
    await reader.read()
    cancellation.abort()
    const errorFrame = new TextDecoder().decode((await reader.read()).value)
    expect(errorFrame).toContain('fallback')
    expect(errorFrame).not.toContain('private-provider-message')
    expect((await reader.read()).done).toBe(true)
    expect(finalized).toBe(true)
  })

  it('ignores a legacy body sessionKey and issues a secure session cookie', async () => {
    chat.mockReturnValueOnce(responseEvents())
    const req = new NextRequest('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ mode: 'shopping', text: 'hello', sessionKey: 'attacker-key' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(req)
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: expect.not.stringMatching(/^attacker-key$/),
      }),
      expect.objectContaining({ signal: expect.anything() }),
    )
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/evoloop_ai_session=[^;]+/i)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=1800')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=lax')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('does not accept a client-chosen UUID cookie as a server session', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    chat.mockReturnValue(responseEvents())
    const req = new NextRequest('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
      headers: { 'content-type': 'application/json', cookie: `evoloop_ai_session=${id}` },
    })

    const response = await POST(req)
    expect(chat).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: id }),
      expect.anything(),
    )
    expect(response.headers.get('set-cookie')).not.toContain(`evoloop_ai_session=${id}`)
  })

  it('reuses a server-signed session with only the remaining cookie lifetime', async () => {
    const first = await POST(request())
    const cookie = first.cookies.get(AI_SESSION_COOKIE)!.value
    const id = cookie.split('.')[1]
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(chat.mock.calls[0][0].sessionKey).toBe(id)
    expect(chat.mock.calls[0][0].sessionKey).not.toBe(cookie)
    vi.setSystemTime(now.getTime() + 5 * 60_000)
    const second = await POST(request({ cookie: `${AI_SESSION_COOKIE}=${cookie}` }))
    expect(chat).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionKey: id }),
      expect.anything(),
    )
    expect(second.cookies.get(AI_SESSION_COOKIE)!.value).toBe(cookie)
    expect(second.headers.get('set-cookie')).toContain('Max-Age=1500')
  })

  it('does not reuse an expired session even if the cookie is sent', async () => {
    const first = await POST(request())
    const cookie = first.cookies.get(AI_SESSION_COOKIE)!.value
    const id = chat.mock.calls[0][0].sessionKey
    vi.setSystemTime(now.getTime() + 30 * 60_000)
    await POST(request({ cookie: `${AI_SESSION_COOKIE}=${cookie}` }))
    expect(chat.mock.calls[1][0].sessionKey).not.toBe(id)
  })

  it('keeps Secure in production when a trusted proxy terminates HTTPS', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await POST(request())
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it.each([undefined, '', 'short'])(
    'fails closed before calling AI with invalid production configuration (%#)',
    async (secret) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('AI_SESSION_SECRET', secret)
      const response = await POST(request())
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ code: 'session_unavailable', message: 'fallback' })
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(chat).not.toHaveBeenCalled()
    },
  )

  it.each(['https://attacker.example', 'null', 'http://localhost:3000.attacker.example'])(
    'rejects an untrusted Origin (%s)',
    async (origin) => {
      const response = await POST(request({ origin, 'x-forwarded-host': 'attacker.example' }))
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'invalid_origin' })
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(chat).not.toHaveBeenCalled()
    },
  )

  it.each(['cross-site', 'same-site'])('rejects %s fetches without an Origin', async (site) => {
    const response = await POST(request({ 'sec-fetch-site': site }))
    expect(response.status).toBe(403)
    expect(chat).not.toHaveBeenCalled()
  })

  it('accepts a same-origin browser request', async () => {
    const response = await POST(
      request({ origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(chat).toHaveBeenCalledTimes(1)
    expect(await response.text()).toContain('data: {"type":"done"}')
  })

  it.each([
    ['malformed JSON', '{"text":'],
    ['oversized body', JSON.stringify({ text: 'x'.repeat(17_000) })],
    ['oversized text field', JSON.stringify({ text: 'x'.repeat(801) })],
    ['invalid mode', JSON.stringify({ mode: 'admin', text: 'hello' })],
    ['unknown field', JSON.stringify({ text: 'hello', privateToken: 'secret' })],
    [
      'invalid product handle',
      JSON.stringify({ product: { handle: 'bad/handle', title: 'Shoe' } }),
    ],
    ['invalid foot length', JSON.stringify({ footMm: 500 })],
  ])('rejects %s before session and AI work', async (_label, body) => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      code: 'invalid_request',
      message: 'Request validation failed',
    })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(chat).not.toHaveBeenCalled()
  })

  it.each([undefined, '1'])(
    'stops oversized streaming bodies without trusting length %s',
    async (length) => {
      let reads = 0
      const cancel = vi.fn()
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads++
            controller.enqueue(new Uint8Array(8192))
            if (reads === 20) controller.close()
          },
          cancel,
        },
        { highWaterMark: 0 },
      )
      const req = request(length ? { 'content-length': length } : {})
      Object.defineProperty(req, 'body', { value: stream })
      vi.spyOn(req, 'arrayBuffer').mockImplementation(() => new Response(stream).arrayBuffer())
      const response = await POST(req)
      expect(response.status).toBe(422)
      expect(reads).toBe(3)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(stream.locked).toBe(false)
      expect(chat).not.toHaveBeenCalled()
    },
  )

  it.each(['http://127.0.0.1:3106', 'http://[::1]:3106'])(
    'preserves the original loopback origin %s before NextURL normalization',
    async (origin) => {
      const response = await POST(
        new NextRequest(`${origin}/api/ai/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({ text: 'hello' }),
        }),
      )
      expect(response.status).toBe(200)
      expect(chat).toHaveBeenCalledTimes(1)
    },
  )

  it('does not treat localhost and a loopback IP as interchangeable origins', async () => {
    const response = await POST(
      new NextRequest('http://127.0.0.1:3106/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3106' },
        body: JSON.stringify({ text: 'hello' }),
      }),
    )
    expect(response.status).toBe(403)
    expect(chat).not.toHaveBeenCalled()
  })
})

// ── 请求语言（任务 7）─────────────────────────────────────────────────────────────
// Route Handler 拿不到 URL 段语言（`next/root-params` 在 vitest 下不可用，ADR 0008 决策 5），
// 语言只能来自请求体，缺失/非法时回落 `Accept-Language`。chat 本身被 mock，所以下面的断言针对
// **入口解析**：转交给 chat 的 `locale` 与产出的事件文案。真实 provider/mock/handlers 的端到端
// 行为由 `copy-contract.test.ts` 与生产抽查覆盖。
describe('请求语言从入口贯穿到事件文案', () => {
  // mock 出的 chat 用**收到的 locale** 取词典——事件文案里的语言因此能反过来证明入口的解析结果。
  const localizedReply = (locale: Locale) =>
    (async function* () {
      yield { type: 'delta' as const, text: messages(locale)['assistant.noMatch'] }
      yield { type: 'done' as const }
    })()

  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    chat.mockImplementation((request: { locale: Locale }) => localizedReply(request.locale))
    const response = await POST(
      new NextRequest('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...headers },
      }),
    )
    return {
      status: response.status,
      text: await response.text(),
      locale: chat.mock.calls[chat.mock.calls.length - 1]?.[0].locale as Locale,
    }
  }

  it('body 带合法 locale 时按该语言产出事件文案', async () => {
    const { status, text, locale } = await post({ text: 'hello', locale: 'zh-CN' })
    expect(status).toBe(200)
    expect(locale).toBe('zh-CN')
    expect(text).toContain(messages('zh-CN')['assistant.noMatch'])
    expect(text).not.toContain(messages('en')['assistant.noMatch'])
  })

  it('缺失 locale 时按 Accept-Language 回落', async () => {
    const { text, locale } = await post({ text: 'hello' }, { 'accept-language': 'zh-CN,zh;q=0.9' })
    expect(locale).toBe('zh-CN')
    expect(text).toContain(messages('zh-CN')['assistant.noMatch'])
  })

  it('非法 locale 不 500：回落默认语言', async () => {
    const { status, text, locale } = await post({ text: 'hello', locale: 'xx' })
    expect(status).toBe(200)
    expect(locale).toBe('en')
    expect(text).toContain(messages('en')['assistant.noMatch'])
  })

  it('locale 是非字符串时不崩溃，回落默认语言', async () => {
    const { status, text, locale } = await post({ text: 'hello', locale: 123 })
    expect(status).toBe(200)
    expect(locale).toBe('en')
    expect(text).toContain(messages('en')['assistant.noMatch'])
  })

  it('新增 locale 字段没有放宽未知字段校验：evil:1 仍然是 invalid_request', async () => {
    const { status, text } = await post({ text: 'hello', locale: 'zh-CN', evil: 1 })
    expect(status).toBe(422)
    expect(JSON.parse(text)).toEqual({
      code: 'invalid_request',
      message: 'Request validation failed',
    })
  })
})
