import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

export const AI_SESSION_COOKIE = 'evoloop_ai_session'
export const AI_SESSION_MAX_AGE_SECONDS = 30 * 60

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ipToken = /^[0-9a-f:.]+$/i
const signedCookie = /^v1[.]([0-9a-f-]{36})[.]([1-9][0-9]{0,10})[.]([0-9a-f]{64})$/
let developmentSecret: string | undefined

type SessionEnvironment = { NODE_ENV?: string; AI_SESSION_SECRET?: string }

export interface AISession {
  id: string
  issued: boolean
  cookieValue: string
  expiresAt: number
}

export class SessionConfigurationError extends Error {
  constructor() {
    super('AI_SESSION_SECRET must contain at least 32 bytes')
    this.name = 'SessionConfigurationError'
  }
}

function signingSecret(env: SessionEnvironment): string {
  const secret = env.AI_SESSION_SECRET?.trim()
  if (secret) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new SessionConfigurationError()
    return secret
  }
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new SessionConfigurationError()
  }
  return (developmentSecret ??= randomBytes(32).toString('hex'))
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`ai-session:${payload}`).digest()
}

export function isSessionId(value: string | undefined): value is string {
  return value !== undefined && uuidV4.test(value)
}

export function sessionIdFrom(
  request: Pick<NextRequest, 'cookies'>,
  options: { env?: SessionEnvironment; now?: () => number } = {},
): AISession {
  const secret = signingSecret(options.env ?? process.env)
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000)
  const existing = request.cookies.get(AI_SESSION_COOKIE)?.value
  const match = existing && existing.length <= 160 ? signedCookie.exec(existing) : null
  if (existing && match && isSessionId(match[1])) {
    const [, id, expiry, mac] = match
    const expiresAt = Number(expiry)
    const payload = `v1.${id}.${expiry}`
    if (
      expiresAt > now &&
      expiresAt <= now + AI_SESSION_MAX_AGE_SECONDS &&
      timingSafeEqual(Buffer.from(mac, 'hex'), signature(payload, secret))
    ) {
      return { id, issued: false, cookieValue: existing, expiresAt }
    }
  }
  const id = randomUUID()
  const expiresAt = now + AI_SESSION_MAX_AGE_SECONDS
  const payload = `v1.${id}.${expiresAt}`
  return {
    id,
    issued: true,
    cookieValue: `${payload}.${signature(payload, secret).toString('hex')}`,
    expiresAt,
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin' && site !== 'none') return false
  const origin = request.headers.get('origin')
  const originalUrl = Reflect.get(Request.prototype, 'url', request) as string
  return origin === null || origin === new URL(originalUrl).origin
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
