'use client'

import { useState } from 'react'
import { LocaleLink } from '@/components/i18n/locale-link'
import { useLocale, useMessages } from '@/components/i18n/locale-provider'
import { Button } from '@/components/ui/button'
import type { CommerceVariant } from '@/domain/commerce'
import { parseCartView } from '@/domain/commerce-response'
import { commerceRequest } from '@/lib/commerce-client'

export function ProductBuyBar({
  variant,
  selectedLabel,
  colorName,
  loading,
  error,
}: {
  variant: CommerceVariant | null
  selectedLabel: string | null
  colorName: string | null
  loading: boolean
  error: string | null
}) {
  const t = useMessages()
  // 错误文案按界面语言取（commerce-client 的错误码 → 文案映射需要它）；Provider 缺席时
  // useLocale() 返回默认语言，故孤立渲染（含既有测试）仍是英文。
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function add() {
    if (!variant || busy) return
    setBusy(true)
    setMessage('')
    try {
      await commerceRequest('cart/items', parseCartView, {
        method: 'POST',
        body: JSON.stringify({ variant_id: variant.id, quantity: 1 }),
        locale,
      })
      setMessage(t['pdp.buy.added'])
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t['pdp.buy.addFailed'])
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {variant && (
        <p className="text-sm">
          {variant.currency} {variant.price} · {variant.available} {t['pdp.buy.available']}
        </p>
      )}
      <Button
        type="button"
        className="w-full py-2.5 text-base"
        disabled={loading || busy || !variant || variant.available < 1}
        onClick={add}
      >
        {busy ? t['pdp.buy.adding'] : t['pdp.buy.addToCart']}
      </Button>
      <p role="status" className="min-h-4 text-xs leading-5 text-neutral-500">
        {message ||
          error ||
          (loading
            ? t['pdp.buy.loading']
            : !selectedLabel
              ? t['pdp.buy.chooseOptions']
              : !variant
                ? t['pdp.buy.unavailable']
                : `${colorName} · ${selectedLabel} ${t['pdp.buy.selected']}`)}
      </p>
      <LocaleLink href="/cart" className="text-sm underline underline-offset-4">
        {t['pdp.buy.viewCart']}
      </LocaleLink>
    </div>
  )
}
