import type { ReactNode } from 'react'
import { SiteShell } from '@/components/marketing/site-shell'

// PDP：全局壳。SSG/动态参数语义不受影响（布局不在 generateStaticParams 范围）。
export default function ProductLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>
}
