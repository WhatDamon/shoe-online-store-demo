import type { ReactNode } from 'react'
import { SiteShell } from '@/components/marketing/site-shell'

// /shop：全局壳（solid 头部 + Footer），页面只负责内容与筛选状态。
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>
}
