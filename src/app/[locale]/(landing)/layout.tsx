import type { ReactNode } from 'react'
import { SiteShell } from '@/components/marketing/site-shell'

// Landing 使用 overlay 变体：固定头部在顶部透明（白色文字），压在 Hero 深色全出血
// 图上，滚动后磨砂。其余路由组（/shop、/product）走 solid 变体。
export default function LandingLayout({ children }: { children: ReactNode }) {
  return <SiteShell tone="overlay">{children}</SiteShell>
}
