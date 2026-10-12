import Link from 'next/link'
import { STATUS_CTA_CLASS, StatusShell } from '@/components/marketing/status-shell'

// 消费者语气（克制，无技术措辞）：未知页面 / 未知商品 handle → 404。
// 未知路径在根布局下渲染（无组布局），故 StatusShell 自带全局壳保证导航/Footer 一致。
export default function NotFound() {
  return (
    <StatusShell
      title="We couldn't find that page"
      description="It may have moved, or the link may be out of date. The shop is still open, though."
    >
      <Link href="/shop" className={`mt-8 ${STATUS_CTA_CLASS}`}>
        Browse the shop
      </Link>
    </StatusShell>
  )
}
