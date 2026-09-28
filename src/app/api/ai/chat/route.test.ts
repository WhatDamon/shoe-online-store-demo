import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('@/server/ai/chat', () => ({
  chat,
  FALLBACK_ERROR_TEXT: 'fallback',
}))

import { POST } from './route'

afterEach(() => {
  chat.mockReset()
})

function responseEvents() {
  return (async function* () {
    yield { type: 'done' as const }
  })()
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
  })

  it('reuses a valid server cookie on the next request', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    chat.mockReturnValue(responseEvents())
    const req = new NextRequest('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
      headers: { 'content-type': 'application/json', cookie: `evoloop_ai_session=${id}` },
    })

    const response = await POST(req)
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: id }))
    expect(response.headers.get('set-cookie')).toContain(`evoloop_ai_session=${id}`)
  })
})
