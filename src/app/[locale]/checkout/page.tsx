import type { Metadata } from 'next'
import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'
import { pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await props.params
  return pageMetadata(isLocale(raw) ? raw : DEFAULT_LOCALE, {
    title: 'Checkout',
    description: 'Evoloop checkout demo.',
    path: '/checkout',
    robots: { index: false, follow: false },
  })
}

export default function CheckoutPage() {
  return (
    <SiteShell>
      <CommercePanel mode="checkout" />
    </SiteShell>
  )
}
