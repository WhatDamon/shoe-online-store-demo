import type { Metadata } from 'next'
import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Order status',
  description: 'View an Evoloop order status.',
  robots: { index: false, follow: false },
})

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <SiteShell>
      <CommercePanel mode="order" orderId={id} />
    </SiteShell>
  )
}
