import type { Metadata } from 'next'
import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Checkout',
  description: 'Evoloop checkout demo.',
  robots: { index: false, follow: false },
})

export default function CheckoutPage() {
  return (
    <SiteShell>
      <CommercePanel mode="checkout" />
    </SiteShell>
  )
}
