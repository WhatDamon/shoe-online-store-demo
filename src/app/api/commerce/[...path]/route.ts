import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
const cookieName = 'evoloop_cart_session'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function allowed(path: string, method: string): boolean {
  if (method === 'GET')
    return /^(catalog\/products(?:\/[a-z0-9-]+)?|cart|orders\/[0-9a-f-]+)$/.test(path)
  if (method === 'POST')
    return /^(cart\/items|checkout\/(preview|create-order)|orders\/[0-9a-f-]+\/cancel|payments\/session)$/.test(
      path,
    )
  return ['PATCH', 'DELETE'].includes(method) && /^cart\/items\/[0-9a-f-]+$/.test(path)
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  // Ignore public request IDs; the proxy owns cross-service correlation.
  const requestId = crypto.randomUUID()
  const responseHeaders = { 'Cache-Control': 'no-store', 'X-Request-ID': requestId }
  const path = (await ctx.params).path.join('/')
  if (!allowed(path, req.method))
    return NextResponse.json(
      { code: 'not_found', detail: 'not_found' },
      { status: 404, headers: responseHeaders },
    )
  const origin = req.headers.get('origin')
  // Next may normalize nextUrl to localhost internally. Use the actual request
  // Host for same-origin checks (also works when opening the site via 127.0.0.1).
  const requestOrigin = `${req.nextUrl.protocol}//${req.headers.get('host') ?? req.nextUrl.host}`
  if (
    req.method !== 'GET' &&
    ((origin && origin !== requestOrigin) || req.headers.get('sec-fetch-site') === 'cross-site')
  ) {
    return NextResponse.json(
      { code: 'invalid_origin', detail: 'invalid_origin' },
      { status: 403, headers: responseHeaders },
    )
  }
  const proxySecret = process.env.COMMERCE_PROXY_SECRET?.trim() ?? ''
  const production = (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
  if (production && new TextEncoder().encode(proxySecret).byteLength < 32) {
    return NextResponse.json(
      { code: 'backend_unavailable', detail: 'backend_unavailable' },
      { status: 503, headers: responseHeaders },
    )
  }
  const existing = req.cookies.get(cookieName)?.value
  const session = existing && uuid.test(existing) ? existing : crypto.randomUUID()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': session,
    'X-Request-ID': requestId,
  }
  if (proxySecret) headers['X-Internal-Proxy-Secret'] = proxySecret
  const key = req.headers.get('idempotency-key')
  if (key) headers['Idempotency-Key'] = key
  let response: NextResponse
  try {
    const upstream = await fetch(
      `${process.env.PYTHON_API_URL ?? 'http://127.0.0.1:8000'}/api/v1/${path}`,
      {
        method: req.method,
        headers,
        body: req.method === 'GET' ? undefined : await req.text(),
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      },
    )
    if (upstream.status >= 500) {
      // Upstream failures may contain infrastructure details. Preserve status, not the body.
      await upstream.body?.cancel()
      response = NextResponse.json(
        { code: 'backend_unavailable', detail: 'backend_unavailable' },
        { status: upstream.status, headers: responseHeaders },
      )
    } else {
      response = new NextResponse(await upstream.text(), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...responseHeaders },
      })
    }
  } catch {
    response = NextResponse.json(
      { code: 'backend_unavailable', detail: 'backend_unavailable' },
      { status: 503, headers: responseHeaders },
    )
  }
  if (existing !== session)
    response.cookies.set(cookieName, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  return response
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE }
