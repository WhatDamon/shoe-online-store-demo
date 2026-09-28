import type { Metadata } from 'next'
import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Cart',
  description: 'Review your saved Evoloop selections.',
  robots: { index: false, follow: false },
})

export default function CartPage() {
  return (
    <SiteShell>
      <CommercePanel mode="cart" />
    </SiteShell>
  )
}
