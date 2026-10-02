// @vitest-environment node
import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatProvider } from './openai-compat'
import { createDb } from '@/db/client'
import { aiBudgetDays, aiBudgetReservations, aiUsage } from '@/db/schema'
import { createRepository } from '@/server/search/repository'
import { createGuardrails } from '@/server/guardrails'
import { chat } from './chat'

beforeEach(() => {
  vi.stubEnv('AI_API_KEY', 'public-test-key-never-a-real-credential')
  vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '2000')
})
afterEach(() => vi.unstubAllEnvs())

async function gateway(handler: (response: ServerResponse) => void) {
  let requests = 0
  const sockets = new Set<Socket>()
  const server = createServer((_request, response) => {
    requests++
    handler(response)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  vi.stubEnv('AI_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)
  return {
    requests: () => requests,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

describe('real SDK against an isolated loopback gateway', () => {
  it('does not log private upstream content when malformed SSE parsing fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await gateway((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: private-upstream-marker\n\n')
    })
    try {
      const stream = new OpenAICompatProvider().stream({
        messages: [],
        system: 'test',
        maxTokens: 10,
      })
      await expect(stream.next()).rejects.toThrow()
      expect(log.mock.calls.flat().join(' ')).not.toContain('private-upstream-marker')
    } finally {
      await server.close()
      log.mockRestore()
    }
  })

  it('makes only one attempt on an upstream 500 instead of retrying within one reservation', async () => {
    const server = await gateway((response) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'test-upstream-failure' } }))
    })
    try {
      const stream = new OpenAICompatProvider().stream({
        messages: [],
        system: 'test',
        maxTokens: 10,
      })
      await expect(stream.next()).rejects.toThrow()
      expect(server.requests()).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('records provider-reported usage from the final streaming chunk', async () => {
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const server = await gateway((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'measured reply' } }] })}`,
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })}`,
          'data: [DONE]',
        ].join('\n\n') + '\n\n',
      )
    })
    try {
      const events = []
      for await (const event of chat(
        {
          sessionKey: 'measured-usage',
          ip: '127.0.0.1',
          mode: 'support',
          text: 'store policy',
          product: null,
        },
        { guardrails, provider: new OpenAICompatProvider() },
      )) {
        events.push(event)
      }
      expect(events).toMatchObject([{ type: 'delta', text: 'measured reply' }, { type: 'done' }])
      expect(database.select().from(aiUsage).all()).toMatchObject([
        { promptTokens: 12, completionTokens: 3 },
      ])
    } finally {
      guardrails.dispose()
      await server.close()
    }
  })

  it.each(['caller cancellation', 'deadline'] as const)(
    'rejects %s after partial output and closes the transport',
    async (reason) => {
      if (reason === 'deadline') vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '1000')
      let markClosed: () => void
      const closed = new Promise<void>((resolve) => {
        markClosed = resolve
      })
      const server = await gateway((response) => {
        response.on('close', () => markClosed())
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`,
        )
      })
      const cancellation = new AbortController()
      const stream = new OpenAICompatProvider().stream({
        messages: [],
        system: 'test',
        maxTokens: 10,
        signal: cancellation.signal,
      })
      try {
        expect((await stream.next()).value).toBe('partial')
        if (reason === 'caller cancellation') cancellation.abort()
        await expect(stream.next()).rejects.toThrow()
        await closed
        expect(server.requests()).toBe(1)
      } finally {
        await stream.return(undefined)
        await server.close()
      }
    },
  )

  it('accounts for a real SDK partial-stream timeout without recording it as a completed reply', async () => {
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '1000')
    vi.stubEnv('AI_DAILY_TOKEN_CAP', '1000000')
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {})
    const database = createDb(':memory:')
    const guardrails = createGuardrails(createRepository(database))
    const server = await gateway((response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`,
      )
    })
    const request = {
      sessionKey: 'sdk-timeout',
      ip: '127.0.0.1',
      mode: 'support' as const,
      text: 'store policy',
      product: null,
    }
    try {
      const events = []
      for await (const event of chat(request, { guardrails, provider: new OpenAICompatProvider() }))
        events.push(event)
      expect(events).toMatchObject([
        { type: 'delta', text: 'partial' },
        { type: 'error', code: 'provider' },
      ])
      const reservation = database.select().from(aiBudgetReservations).all()[0]
      expect(reservation.status).toBe('abandoned')
      expect(database.select().from(aiBudgetDays).all()[0]).toMatchObject({
        reservedTokens: 0,
        usedTokens: reservation.reservedTokens,
      })
      expect(database.select().from(aiUsage).all()).toHaveLength(0)
      expect(guardrails.assertTurn(request.sessionKey)).toEqual([])
      expect(server.requests()).toBe(1)
    } finally {
      guardrails.dispose()
      await server.close()
      logging.mockRestore()
    }
  })
})
