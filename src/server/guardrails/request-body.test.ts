// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { readRequestBody } from './request-body'

function request(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  const req = new Request('http://localhost/test', { headers, signal })
  Object.defineProperty(req, 'body', { value: body })
  return req
}

it('accepts the exact byte boundary and preserves split UTF-8 bytes', async () => {
  const bytes = new TextEncoder().encode('鞋')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1))
      controller.enqueue(bytes.slice(1))
      controller.close()
    },
  })
  expect(await readRequestBody(request(stream), bytes.length)).toEqual(bytes)
  expect(stream.locked).toBe(false)
})

it('accepts an absent body', async () => {
  expect(await readRequestBody(new Request('http://localhost/test'), 16)).toEqual(new Uint8Array(0))
})

it('cancels advertised oversized bodies before pulling', async () => {
  const pull = vi.fn()
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
  await expect(
    readRequestBody(request(stream, { 'content-length': '17' }), 16),
  ).rejects.toMatchObject({ code: 'too_large' })
  expect(pull).not.toHaveBeenCalled()
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(stream.locked).toBe(false)
})

it('cancels after the first oversized chunk and tolerates cancellation failures', async () => {
  const cancel = vi.fn().mockRejectedValue(new Error('private-cancel-error'))
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(17))
    },
    cancel,
  })
  await expect(readRequestBody(request(stream), 16)).rejects.toMatchObject({
    code: 'too_large',
    message: 'too_large',
  })
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(stream.locked).toBe(false)
})

it('cancels a pending read on inbound abort without leaking partial input', async () => {
  const cancellation = new AbortController()
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
  const pending = readRequestBody(request(stream, {}, cancellation.signal), 16)
  cancellation.abort()
  await expect(pending).rejects.toMatchObject({ code: 'invalid_body' })
  expect(cancel).toHaveBeenCalled()
  expect(stream.locked).toBe(false)
})

it('sanitizes source errors and releases the stream lock', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('private-body-error'))
    },
  })
  await expect(readRequestBody(request(stream), 16)).rejects.toMatchObject({
    code: 'invalid_body',
    message: 'invalid_body',
  })
  expect(stream.locked).toBe(false)
})
