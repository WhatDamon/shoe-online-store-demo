'use client'

import { LocaleLink } from '@/components/i18n/locale-link'
import { useLocale, useMessages } from '@/components/i18n/locale-provider'
import { useEffect, useRef, useState } from 'react'
import type { CartView, OrderView } from '@/domain/commerce'
import { parseCartView, parseOrderView } from '@/domain/commerce-response'
import { commerceRequest } from '@/lib/commerce-client'
import { Button } from '@/components/ui/button'

const pendingKey = 'evoloop-pending-checkout'

export function CommercePanel({
  mode,
  orderId,
}: {
  mode: 'cart' | 'checkout' | 'order'
  orderId?: string
}) {
  const t = useMessages()
  // 错误文案按界面语言取（commerce-client 的错误码 → 文案映射需要它）；Provider 缺席时
  // useLocale() 返回默认语言，故孤立渲染（含既有测试）仍是英文。
  const locale = useLocale()
  const [cart, setCart] = useState<CartView | null>(null)
  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retryPending, setRetryPending] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    const request =
      mode === 'order'
        ? commerceRequest(`orders/${orderId}`, parseOrderView, { locale }).then((data) => {
            if (active) setOrder(data)
          })
        : commerceRequest(
            mode === 'checkout' ? 'checkout/preview' : 'cart',
            parseCartView,
            mode === 'checkout' ? { method: 'POST', locale } : { locale },
          ).then((data) => {
            if (active) setCart(data)
          })
    request
      .then(() => {
        if (!active) return
        setRetryPending(Boolean(sessionStorage.getItem(pendingKey)))
      })
      .catch((e: Error) => {
        if (active) {
          setError(e.message)
          setRetryPending(Boolean(sessionStorage.getItem(pendingKey)))
        }
      })
    return () => {
      active = false
    }
  }, [mode, orderId, locale])

  async function act(operation: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(e instanceof Error ? e.message : t['errors.unexpected'])
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  function change(id: string, quantity?: number) {
    return act(async () =>
      setCart(
        await commerceRequest(
          `cart/items/${id}`,
          parseCartView,
          quantity == null
            ? { method: 'DELETE', locale }
            : { method: 'PATCH', body: JSON.stringify({ quantity }), locale },
        ),
      ),
    )
  }

  function createOrder() {
    return act(async () => {
      const key = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID()
      sessionStorage.setItem(pendingKey, key)
      setRetryPending(true)
      const created = await commerceRequest('checkout/create-order', parseOrderView, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        locale,
      })
      setOrder(created)
      sessionStorage.removeItem(pendingKey)
      sessionStorage.setItem('evoloop-last-order', created.id)
    })
  }

  const view = order ?? cart
  const hasUnavailableItems = cart?.items.some((item) => item.sellable === false) ?? false
  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="font-heading text-3xl font-semibold">
        {order || mode === 'order'
          ? t['orders.title']
          : mode === 'cart'
            ? t['cart.title']
            : t['checkout.title']}
      </h1>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 p-4 text-red-700">
          {error}
        </p>
      )}
      {!view && !error && <p role="status">{t['errors.loading']}</p>}
      {order && (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-surface p-5">
          <p className="break-all">
            {t['orders.orderId']} {order.id}
          </p>
          <p>
            {t['orders.status']}{' '}
            {order.status === 'cancelled'
              ? order.cancellation_reason === 'expired'
                ? t['orders.statusExpired']
                : t['orders.statusCancelled']
              : t['orders.statusPendingPayment']}
          </p>
          <p role="status" className="font-semibold">
            {t['orders.paymentsDisabled']}
          </p>
          <p className="text-sm text-neutral-600">
            {order.status === 'cancelled' ? t['orders.releasedCopy'] : t['orders.pendingCopy']}
          </p>
          {order.status === 'pending_payment' && order.expires_at && (
            <p className="text-sm text-neutral-600">
              {t['orders.reservedUntil']}{' '}
              <time dateTime={order.expires_at}>{new Date(order.expires_at).toLocaleString()}</time>
            </p>
          )}
          <button
            type="button"
            className="text-sm underline"
            disabled={busy}
            onClick={() =>
              act(async () =>
                setOrder(await commerceRequest(`orders/${order.id}`, parseOrderView, { locale })),
              )
            }
          >
            {t['orders.refresh']}
          </button>
          <LocaleLink href={`/orders/${order.id}`} className="text-sm underline">
            {t['orders.permanentLink']}
          </LocaleLink>
        </div>
      )}
      {view?.items.map((item) => (
        <article
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 py-4"
        >
          <div className="space-y-1">
            <h2 className="font-medium">{item.title}</h2>
            {/*`EU <n>` 与色名/货号是数据：尺码体系不得因语言漂移（ADR 0008 决策 6），不进词典。 */}
            <p className="text-sm text-neutral-600">
              {item.color} · EU {item.size}
            </p>
            <p className="text-xs text-neutral-500">{item.sku}</p>
            {!order && item.sellable === false && (
              <p className="text-sm text-red-700">{t['cart.itemUnavailable']}</p>
            )}
            <p>
              {view.currency} {item.unit_price} {t['cart.perPair']}
            </p>
          </div>
          {mode === 'cart' && !order ? (
            <div className="flex items-center gap-3">
              <label className="text-sm">
                {t['cart.quantityLabel']}
                <select
                  aria-label={`${item.title} ${t['cart.quantityAria']}`}
                  className="ml-2 rounded border p-2"
                  value={item.quantity}
                  disabled={busy || item.sellable === false}
                  onChange={(event) => change(item.id, Number(event.target.value))}
                >
                  {Array.from({ length: 99 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} onClick={() => change(item.id)} className="text-sm underline">
                {t['cart.remove']} {item.title}
              </button>
            </div>
          ) : (
            <p>
              {t['cart.quantitySummary']} {item.quantity}
            </p>
          )}
        </article>
      ))}
      {view && (
        <p className="text-xl font-semibold">
          {t['cart.total']} {view.currency} {view.total}
        </p>
      )}
      {view?.items.length === 0 && <p>{t['cart.empty']}</p>}
      {mode === 'cart' && Boolean(cart?.items.length) && !hasUnavailableItems && (
        <LocaleLink
          href="/checkout"
          className="inline-block rounded-full bg-ink px-6 py-3 text-white"
        >
          {t['cart.reviewCheckout']}
        </LocaleLink>
      )}
      {mode === 'checkout' && !order && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">{t['checkout.note']}</p>
          <Button
            disabled={busy || ((!cart?.items.length || hasUnavailableItems) && !retryPending)}
            onClick={createOrder}
          >
            {busy
              ? t['checkout.creating']
              : retryPending
                ? t['checkout.retry']
                : t['checkout.create']}
          </Button>
        </div>
      )}
      {order?.status === 'pending_payment' && (
        <Button
          disabled={busy}
          onClick={() =>
            act(async () =>
              setOrder(
                await commerceRequest(`orders/${order.id}/cancel`, parseOrderView, {
                  method: 'POST',
                  locale,
                }),
              ),
            )
          }
        >
          {t['orders.cancel']}
        </Button>
      )}
      <div className="flex gap-5 text-sm underline">
        <LocaleLink href="/shop">{t['cart.continueShopping']}</LocaleLink>
        {mode !== 'cart' && <LocaleLink href="/cart">{t['cart.backToCart']}</LocaleLink>}
      </div>
    </section>
  )
}
