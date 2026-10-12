import type { Metadata } from 'next'
import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'
import { pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale: raw, id } = await props.params
  return pageMetadata(isLocale(raw) ? raw : DEFAULT_LOCALE, {
    title: 'Order status',
    description: 'View an Evoloop order status.',
    path: `/orders/${id}`,
    robots: { index: false, follow: false },
  })
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <SiteShell>
      <CommercePanel mode="order" orderId={id} />
    </SiteShell>
  )
}
