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
    expect(chat).not.toHaveBeenCalledWith(expect.objectContaining({ sessionKey: id }))
    expect(response.headers.get('set-cookie')).not.toContain(`evoloop_ai_session=${id}`)
  })

  it('reuses a server-signed session with only the remaining cookie lifetime', async () => {
    const first = await POST(request())
    const cookie = first.cookies.get(AI_SESSION_COOKIE)!.value
    const id = chat.mock.calls[0][0].sessionKey
    vi.setSystemTime(now.getTime() + 5 * 60_000)
    const second = await POST(request({ cookie: `${AI_SESSION_COOKIE}=${cookie}` }))
    expect(chat).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: id }))
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
    expect(chat).toHaveBeenCalledTimes(1)
    expect(await response.text()).toContain('data: {"type":"done"}')
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
