'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CommerceVariant } from '@/domain/commerce'
import { parseCartView } from '@/domain/commerce-response'
import { commerceRequest } from '@/lib/commerce-client'

const ADD_TIMEOUT_MS = 15_000

export function ProductBuyBar({
  variant,
  selectedLabel,
  colorName,
  loading,
  error,
  onRecheck,
  onBusyChange,
}: {
  variant: CommerceVariant | null
  selectedLabel: string | null
  colorName: string | null
  loading: boolean
  error: string | null
  onRecheck?: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState<{ variantId: string; text: string } | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current?.abort()
    }
  }, [])
  const disabled = loading || !!error || failed || busy || !variant || variant.available < 1

  async function add() {
    if (disabled || !variant || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    onBusyChange?.(true)
    setMessage(null)
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), ADD_TIMEOUT_MS)
    try {
      await commerceRequest('cart/items', parseCartView, {
        method: 'POST',
        body: JSON.stringify({ variant_id: variant.id, quantity: 1 }),
        signal: controller.signal,
      })
      if (mounted.current) setMessage({ variantId: variant.id, text: 'Added to cart.' })
    } catch (failure) {
      if (!mounted.current) return
      setFailed(true)
      setMessage({
        variantId: variant.id,
        text: controller.signal.aborted
          ? 'The request timed out. Check your cart before trying again.'
          : failure instanceof Error
            ? failure.message
            : 'Could not add this item to your cart.',
      })
    } finally {
      clearTimeout(timeout)
      inFlight.current = false
      if (mounted.current) {
        setBusy(false)
        onBusyChange?.(false)
      }
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {variant && !loading && !error && (
        <p className="text-sm">
          {variant.currency} {variant.price} · {variant.available} available
        </p>
      )}
      <Button type="button" className="w-full py-2.5 text-base" disabled={disabled} onClick={add}>
        {busy ? 'Adding...' : 'Add to cart'}
      </Button>
      <p role="status" className="min-h-4 text-xs leading-5 text-neutral-500">
        {loading
          ? 'Loading available options...'
          : error ||
            (failed || message?.variantId === variant?.id ? message?.text : '') ||
            (!selectedLabel
              ? 'Choose a color and size.'
              : !variant
                ? 'This color and size are unavailable.'
                : `${colorName} · ${selectedLabel} selected`)}
      </p>
      {(failed || error) && onRecheck ? (
        <Button type="button" disabled={loading || busy} onClick={onRecheck}>
          Recheck availability
        </Button>
      ) : null}
      <Link href="/cart" className="text-sm underline underline-offset-4">
        View cart
      </Link>
    </div>
  )
}
