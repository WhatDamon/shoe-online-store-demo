import type { Metadata } from 'next'
import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Order status',
  description: 'View an Evoloop order status.',
  robots: { index: false, follow: false },
})

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ payment?: string }>
}) {
  const { id } = await params
  const { payment } = await searchParams
  // The query parameter is forgeable, so it only ever selects a banner. The panel re-reads the
  // order from the trading boundary and shows whatever that says.
  const paymentNotice = payment === 'success' || payment === 'cancelled' ? payment : null
  return (
    <SiteShell>
      <CommercePanel mode="order" orderId={id} paymentNotice={paymentNotice} />
    </SiteShell>
  )
}
