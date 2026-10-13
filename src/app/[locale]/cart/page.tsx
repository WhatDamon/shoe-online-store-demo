import type { Metadata } from 'next'
import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'
import { pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await props.params
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)
  return pageMetadata(locale, {
    title: t['cart.title'],
    description: t['cart.meta.description'],
    path: '/cart',
    robots: { index: false, follow: false },
  })
}

export default function CartPage() {
  return (
    <SiteShell>
      <CommercePanel mode="cart" />
    </SiteShell>
  )
}
