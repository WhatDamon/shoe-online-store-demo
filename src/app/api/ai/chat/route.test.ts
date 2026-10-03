import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AI_SESSION_COOKIE } from '@/server/guardrails/request'

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('@/server/ai/chat', () => ({
  chat,
  FALLBACK_ERROR_TEXT: 'fallback',
}))

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
    const id = chat.mock.calls[0][0].sessionKey
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
