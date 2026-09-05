import type { ReactNode } from 'react'
import { SiteShell } from '@/components/marketing/site-shell'

// /blog：全局壳（solid 头部 + Footer），页面只负责内容。
export default function BlogLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>
}
