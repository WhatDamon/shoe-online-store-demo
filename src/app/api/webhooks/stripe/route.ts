import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { envStr } from '@/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `constructEvent` verifies with the signing secret alone and never calls the Stripe API, so
 * this placeholder is not a credential: the Next side deliberately holds no Stripe API key.
 * (Constructing with an empty string throws, which would turn every delivery into a 400.)
 */
const verifier = new Stripe('sk_placeholder_for_webhook_verification')

/**
 * Public Stripe ingress. Stripe calls this server-to-server, so it sits outside the
 * `/api/commerce` proxy and its same-origin rule, and it holds only the webhook signing
 * secret — never `STRIPE_SECRET_KEY`.
 *
 * Two rules here are deliberately the opposite of the commerce proxy:
 *  - the raw body is verified **before** anything else looks at it (any parsed body breaks
 *    the signature), and
 *  - the upstream status is passed through verbatim, including 5xx. That is the signal that
 *    makes Stripe retry; folding it into `backend_unavailable` would silently drop a payment.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const secret = envStr('STRIPE_WEBHOOK_SECRET')
  if (!secret) return json(503, 'webhook_not_configured')

  const payload = await request.text()
  const header = request.headers.get('stripe-signature') ?? ''
  let event: Stripe.Event
  try {
    event = verifier.webhooks.constructEvent(payload, header, secret)
  } catch {
    // Never echo the raw body or the signature back to the caller.
    return json(400, 'invalid_signature')
  }

  const projected = project(event)
  // An event we cannot project (no `payment_status`) is not forwardable: the projection
  // requires it, so forwarding would turn a 200 into an endless Stripe retry. Answering 2xx
  // is also correct for events this store does not act on.
  if (!projected) return json(200, 'ignored')

  const upstream = `${envStr('PYTHON_API_URL', 'http://127.0.0.1:8000')}/api/v1/webhooks/stripe`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
  }
  const proxySecret = envStr('COMMERCE_PROXY_SECRET')
  if (!proxySecret) return json(503, 'proxy_not_configured')
  headers['X-Internal-Proxy-Secret'] = proxySecret

  try {
    const response = await fetch(upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify(projected),
    })
    return json(response.status, response.status === 200 ? 'ok' : 'upstream_rejected')
  } catch {
    return json(502, 'upstream_unreachable')
  }
}

interface Projection {
  id: string
  type: string
  payment_status: string
  order_id: string | null
  checkout_session_id: string | null
  payment_intent: string | null
  amount_total: number | null
  currency: string | null
}

/** Projects a Checkout Session event down to the fields the trading boundary acts on. */
function project(event: Stripe.Event): Projection | null {
  if (!event.type.startsWith('checkout.session.')) return null
  const session = event.data.object as Stripe.Checkout.Session
  const paymentStatus = session.payment_status
  if (
    paymentStatus !== 'paid' &&
    paymentStatus !== 'unpaid' &&
    paymentStatus !== 'no_payment_required'
  )
    return null
  const identifier = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
  return {
    id: event.id,
    type: event.type,
    payment_status: paymentStatus,
    order_id: identifier(session.client_reference_id),
    checkout_session_id: identifier(session.id),
    payment_intent:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : identifier(session.payment_intent?.id),
    amount_total: typeof session.amount_total === 'number' ? session.amount_total : null,
    currency: typeof session.currency === 'string' ? session.currency : null,
  }
}

function json(status: number, code: string): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
