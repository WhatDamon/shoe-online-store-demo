import type { NextRequest } from 'next/server'

export const AI_SESSION_COOKIE = 'evoloop_ai_session'
export const AI_SESSION_MAX_AGE_SECONDS = 30 * 60

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ipToken = /^[0-9a-f:.]+$/i

export function isSessionId(value: string | undefined): value is string {
  return value !== undefined && uuidV4.test(value)
}

export function sessionIdFrom(request: Pick<NextRequest, 'cookies'>): {
  id: string
  issued: boolean
} {
  const existing = request.cookies.get(AI_SESSION_COOKIE)?.value
  return isSessionId(existing)
    ? { id: existing, issued: false }
    : { id: crypto.randomUUID(), issued: true }
}

function configuredProxyIps(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env.TRUSTED_PROXY_IPS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== '' && ipToken.test(value)),
  )
}

/**
 * Resolve a request IP without trusting a browser-supplied forwarding header.
 * Next's edge/runtime adapter may expose the immediate peer as `request.ip`.
 * Only an exact configured peer is allowed to provide X-Forwarded-For; the
 * deployment proxy must strip incoming copies before adding its own header.
 */
export function requestIp(
  request: Pick<NextRequest, 'headers'> & { ip?: string },
  env: Record<string, string | undefined> = process.env,
): string {
  const peer = request.ip?.trim().toLowerCase()
  const trustedPeers = configuredProxyIps(env)
  if (peer && trustedPeers.has(peer)) {
    const forwarded = request.headers.get('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim().toLowerCase()
    if (first && ipToken.test(first)) return first
  }
  // A direct peer is a useful limiter key. If the runtime hides it, use one
  // bounded anonymous bucket rather than accepting an attacker-controlled key.
  return peer && ipToken.test(peer) ? peer : 'untrusted'
}
