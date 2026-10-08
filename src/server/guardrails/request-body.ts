export class RequestBodyError extends Error {
  constructor(readonly code: 'too_large' | 'invalid_body') {
    super(code)
  }
}

/** Bound bytes while reading, including chunked requests and false length headers. */
export async function readRequestBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const length = req.headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
    await req.body?.cancel().catch(() => {})
    throw new RequestBodyError('too_large')
  }
  if (req.signal.aborted) throw new RequestBodyError('invalid_body')
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  req.signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (req.signal.aborted) throw new RequestBodyError('invalid_body')
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new RequestBodyError('too_large')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (error instanceof RequestBodyError) throw error
    throw new RequestBodyError('invalid_body')
  } finally {
    req.signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
